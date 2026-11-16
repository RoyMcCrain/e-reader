export type SwipeDirection = 'left' | 'right'

export const animatePage = (
	element: Element | null,
	direction: SwipeDirection,
	active: { current: Animation | null },
) => {
	if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
		return
	active.current?.cancel()
	const animation = element.animate(
		[
			{ transform: `translateX(${direction === 'left' ? 32 : -32}px)` },
			{ transform: 'translateX(0)' },
		],
		{ duration: 165, easing: 'ease-out' },
	)
	active.current = animation
	animation.onfinish = () => {
		if (active.current === animation) active.current = null
	}
}
