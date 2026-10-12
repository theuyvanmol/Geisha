import type Lenis from 'lenis';

let _lenis: Lenis | null = null;
const subscribers = new Set<(lenis: Lenis | null) => void>();

export function setLenis(lenis: Lenis | null) {
	_lenis = lenis;
	subscribers.forEach((fn) => fn(lenis));
}

export function getLenis(): Lenis | null {
	return _lenis;
}

export function onLenis(fn: (lenis: Lenis | null) => void): () => void {
	subscribers.add(fn);
	if (_lenis) fn(_lenis);
	return () => subscribers.delete(fn);
}
