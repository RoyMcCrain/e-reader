import type { EpubCheckpoint, EpubSession } from '#lib/reader/epub-types'
import {
	adoptRemotePosition,
	fetchRemotePosition,
	loadPosition,
	syncPosition,
	type RemotePosition,
	type SavedPosition,
} from '#lib/reader/positions'

export type PositionSessionResult = {
	status: string
	remote?: RemotePosition
	conflict?: RemotePosition | null
}

interface PositionSessionOptions {
	bookId: string
	epub: Pick<EpubSession, 'checkpoint' | 'restore' | 'untouched'>
	isCurrent: () => boolean
}

const classifyLocal = (local: SavedPosition | undefined) => {
	if (local?.conflict !== undefined) return 'conflict'
	if (local?.pending || local?.sending) return 'pending'
	return 'clean'
}

const localResult = (
	local: SavedPosition | undefined,
): PositionSessionResult => {
	if (local?.conflict !== undefined)
		return { status: 'conflict', conflict: local.conflict }
	if (classifyLocal(local) === 'pending') return { status: 'pending' }
	return { status: 'synced' }
}

export const rollbackPositionSession = async (
	options: PositionSessionOptions,
	checkpoint: EpubCheckpoint,
) => {
	const newest = await loadPosition(options.bookId).catch(() => undefined)
	if (!options.isCurrent()) return newest
	const rollback = newest?.cfi ?? checkpoint.cfi
	if (rollback)
		await options.epub
			.restore(rollback, false, checkpoint.epoch)
			.catch(() => false)
	return newest
}

const restoreRemote = async ({
	epub,
	remote,
	checkpoint,
}: Pick<PositionSessionOptions, 'epub'> & {
	remote: RemotePosition
	checkpoint: EpubCheckpoint
}) => {
	if (remote.cfi === checkpoint.cfi) return true
	if (!epub.untouched()) return false
	return epub.restore(remote.cfi, true, checkpoint.epoch)
}

const rejectedAdoption = async ({
	options,
	checkpoint,
	remote,
	moved,
}: {
	options: PositionSessionOptions
	checkpoint: EpubCheckpoint
	remote: RemotePosition
	moved: boolean
}): Promise<PositionSessionResult> => {
	const newest = moved
		? await rollbackPositionSession(options, checkpoint)
		: await loadPosition(options.bookId).catch(() => undefined)
	if (!options.isCurrent()) return { status: '' }
	if (newest?.conflict !== undefined)
		return { status: 'conflict', conflict: newest.conflict }
	if (!moved) return { ...localResult(newest), remote }
	return { status: '端末の新しい位置を保持しました。', remote }
}

const isOlderRemote = (
	local: SavedPosition | undefined,
	remote: RemotePosition,
) => Boolean(local && remote.revision < local.revision)

const preservesTouchedReader = (
	epub: PositionSessionOptions['epub'],
	remote: RemotePosition,
	local: SavedPosition | undefined,
) => remote.cfi !== local?.cfi && !epub.untouched()

const finishRemoteAdoption = async ({
	options,
	remote,
	local,
	checkpoint,
	moved,
}: {
	options: PositionSessionOptions
	remote: RemotePosition
	local: SavedPosition | undefined
	checkpoint: EpubCheckpoint
	moved: boolean
}): Promise<PositionSessionResult> => {
	const adopted = await adoptRemotePosition(
		options.bookId,
		remote,
		local?.mutationId,
	).catch(() => undefined)
	if (!options.isCurrent()) return { status: '' }
	if (adopted === undefined) {
		if (moved) await rollbackPositionSession(options, checkpoint)
		if (!options.isCurrent()) return { status: '' }
		return { status: '読書位置を保存できません。' }
	}
	if (!adopted) return rejectedAdoption({ options, checkpoint, remote, moved })
	return { status: moved ? '別端末の位置に移動しました。' : 'synced' }
}

const resolveRemote = async ({
	options,
	remote,
	local,
}: {
	options: PositionSessionOptions
	remote: RemotePosition
	local: SavedPosition | undefined
}): Promise<PositionSessionResult> => {
	const { epub, isCurrent } = options
	if (isOlderRemote(local, remote)) return { status: 'synced' }
	const checkpoint = epub.checkpoint()
	if (preservesTouchedReader(epub, remote, local)) return { status: '', remote }
	if (remote.cfi === local?.cfi)
		return finishRemoteAdoption({
			options,
			remote,
			local,
			checkpoint,
			moved: false,
		})
	const restored = await restoreRemote({ epub, remote, checkpoint })
	if (!isCurrent()) return { status: '' }
	if (!restored) return { status: '', remote }
	return finishRemoteAdoption({
		options,
		remote,
		local,
		checkpoint,
		moved: true,
	})
}

const pendingResult = (
	local: SavedPosition | undefined,
	syncStatus: string,
): PositionSessionResult | undefined => {
	if (local?.conflict !== undefined) return localResult(local)
	if (
		classifyLocal(local) === 'pending' ||
		syncStatus === 'pending' ||
		syncStatus === 'auth'
	)
		return { status: syncStatus === 'auth' ? 'auth' : 'pending' }
	return undefined
}

const fetchAndResolve = async (
	options: PositionSessionOptions,
): Promise<PositionSessionResult> => {
	const remote = await fetchRemotePosition(options.bookId)
	if (!options.isCurrent()) return { status: '' }
	const latest = await loadPosition(options.bookId)
	if (!options.isCurrent()) return { status: '' }
	const pending = pendingResult(latest, 'synced')
	if (pending) return pending
	if (!remote) return localResult(latest)
	return resolveRemote({ options, remote, local: latest })
}

const refreshFromCloud = async (
	options: PositionSessionOptions,
): Promise<PositionSessionResult> => {
	const syncStatus = await syncPosition(options.bookId)
	if (!options.isCurrent()) return { status: '' }
	const cached = await loadPosition(options.bookId)
	if (!options.isCurrent()) return { status: '' }
	const pending = pendingResult(cached, syncStatus)
	if (pending) return pending
	return fetchAndResolve(options)
}

export const refreshPositionSession = async (
	options: PositionSessionOptions,
): Promise<PositionSessionResult> => {
	try {
		return await refreshFromCloud(options)
	} catch (cause) {
		if (!options.isCurrent()) return { status: '' }
		const local = await loadPosition(options.bookId).catch(() => undefined)
		if (local?.conflict !== undefined)
			return { status: 'conflict', conflict: local.conflict }
		return {
			status:
				cause instanceof Error && cause.message === 'auth'
					? 'auth'
					: 'クラウドの位置を取得できません。',
		}
	}
}
