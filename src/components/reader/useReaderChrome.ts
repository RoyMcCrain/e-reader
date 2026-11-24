import { useEffect, useState } from 'react'

import { READER_ACTIVITY_EVENT, READER_TURN_EVENT } from '#lib/reader/input'

const FOOTER_IDLE_DELAY = 1000
const HEADER_IDLE_DELAY = 30_000

interface ReaderChromeOptions {
	active: boolean
	file: File
	pinned: boolean
}

const isToolbarFocus = (target: EventTarget | null) =>
	target instanceof Element &&
	Boolean(
		target.closest(
			'[aria-label="読書画面"] header, [aria-label="読書画面"] footer',
		),
	)

export const useReaderChrome = ({
	active,
	file,
	pinned,
}: ReaderChromeOptions) => {
	const [headerVisible, setHeaderVisible] = useState(true)
	const [footerVisible, setFooterVisible] = useState(true)

	useEffect(() => {
		if (!active) return
		let initialTimer: number | undefined
		let headerTimer: number | undefined
		let footerTimer: number | undefined
		let focused = isToolbarFocus(document.activeElement)
		const clearTimers = () => {
			if (initialTimer !== undefined) window.clearTimeout(initialTimer)
			if (headerTimer !== undefined) window.clearTimeout(headerTimer)
			if (footerTimer !== undefined) window.clearTimeout(footerTimer)
			initialTimer = undefined
			headerTimer = undefined
			footerTimer = undefined
		}
		const reveal = () => {
			clearTimers()
			setHeaderVisible(true)
			setFooterVisible(true)
			if (!pinned && !focused) {
				footerTimer = window.setTimeout(
					() => setFooterVisible(false),
					FOOTER_IDLE_DELAY,
				)
				headerTimer = window.setTimeout(
					() => setHeaderVisible(false),
					HEADER_IDLE_DELAY,
				)
			}
		}
		const focusin = (event: FocusEvent) => {
			focused = isToolbarFocus(event.target)
			if (focused) reveal()
		}
		const focusout = (event: FocusEvent) => {
			if (!isToolbarFocus(event.target)) return
			focused = isToolbarFocus(event.relatedTarget)
			reveal()
		}
		const pointermove = (event: PointerEvent) => {
			if (event.pointerType !== 'touch') reveal()
		}
		const click = (event: MouseEvent) => {
			if (!event.defaultPrevented) reveal()
		}
		document.addEventListener('pointermove', pointermove, { passive: true })
		document.addEventListener('click', click)
		document.addEventListener('keydown', reveal, true)
		document.addEventListener('focusin', focusin)
		document.addEventListener('focusout', focusout)
		document.addEventListener(READER_ACTIVITY_EVENT, reveal)
		const hideForTurn = () => {
			if (pinned || focused) {
				reveal()
				return
			}
			clearTimers()
			setHeaderVisible(false)
			setFooterVisible(false)
		}
		document.addEventListener(READER_TURN_EVENT, hideForTurn)
		initialTimer = window.setTimeout(() => {
			initialTimer = undefined
			reveal()
		}, 0)
		return () => {
			clearTimers()
			document.removeEventListener('pointermove', pointermove)
			document.removeEventListener('click', click)
			document.removeEventListener('keydown', reveal, true)
			document.removeEventListener('focusin', focusin)
			document.removeEventListener('focusout', focusout)
			document.removeEventListener(READER_ACTIVITY_EVENT, reveal)
			document.removeEventListener(READER_TURN_EVENT, hideForTurn)
		}
	}, [active, file, pinned])

	return {
		headerVisible: headerVisible || pinned || !active,
		footerVisible: footerVisible || pinned || !active,
	}
}
