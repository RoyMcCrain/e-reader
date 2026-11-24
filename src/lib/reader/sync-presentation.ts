// フッターの読書位置表示の文言と見た目の対応付け。文言の真実の源はこの
// モジュールに集約し、Reader.tsx とテストはここを参照する。エラー系
// （保存の失敗など）と未知の文言は表示しない。新文言を追加したらここに足す。
export const syncStatusText = {
	saving: '端末に保存中…',
	syncing: '端末に保存しました。同期中…',
	saved: '端末に保存し、同期しました。',
	synced: '同期済み',
	kept: '端末の新しい位置を保持しました。',
	moved: '別端末の位置に移動しました。',
	pending: '同期は保留中です。',
	conflict: '同期に競合があります。',
	auth: 'ログインすると同期できます。',
} as const

const spinnerStatuses: Set<string> = new Set([
	syncStatusText.saving,
	syncStatusText.syncing,
])

const checkStatuses: Set<string> = new Set([
	syncStatusText.saved,
	syncStatusText.synced,
	syncStatusText.kept,
	syncStatusText.moved,
])

export const syncPresentation = (status: string) => {
	if (spinnerStatuses.has(status)) return 'spinner'
	if (checkStatuses.has(status)) return 'check'
	if (status === syncStatusText.pending) return 'clock'
	if (status === syncStatusText.conflict) return 'alert'
	if (status === syncStatusText.auth) return 'login'
	return null
}
