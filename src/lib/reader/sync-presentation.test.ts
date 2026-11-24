import { describe, expect, test } from 'vitest'

import { syncPresentation, syncStatusText } from '#lib/reader/sync-presentation'

describe('sync presentation', () => {
	test('進行中の保存と同期はスピナーになる', () => {
		expect(syncPresentation(syncStatusText.saving)).toBe('spinner')
		expect(syncPresentation(syncStatusText.syncing)).toBe('spinner')
	})

	test('保存と同期の完了はチェックになる', () => {
		expect(syncPresentation(syncStatusText.saved)).toBe('check')
		expect(syncPresentation(syncStatusText.synced)).toBe('check')
		expect(syncPresentation(syncStatusText.moved)).toBe('check')
		expect(syncPresentation(syncStatusText.kept)).toBe('check')
	})

	test('保留・競合・未ログインは対応するアイコンになる', () => {
		expect(syncPresentation(syncStatusText.pending)).toBe('clock')
		expect(syncPresentation(syncStatusText.conflict)).toBe('alert')
		expect(syncPresentation(syncStatusText.auth)).toBe('login')
	})

	test('空・エラー・未知の文言は表示しない', () => {
		for (const status of [
			'',
			'読書位置を保存できません。',
			'端末内の読書位置を利用できません。',
			'保存した位置を開けず、先頭から表示しています。',
			'なにか未知の文言',
		])
			expect(syncPresentation(status)).toBeNull()
	})
})
