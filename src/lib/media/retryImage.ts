// Svelte action: retry an <img> that fails to load.
//
// A file uploaded seconds ago is not always servable from the CDN in front of R2
// yet — the first request can miss, and a miss is what the browser caches as "no
// image". The result was a blank box that only came back on a page refresh,
// which staff reasonably read as "my upload didn't work".
//
// The in-session object URL (see localPreviews.ts) covers the tab that did the
// uploading. This covers everything else: another tab, after a reload, or a
// pre-existing file whose first request simply lost a race. A handful of retries
// with a growing gap, then it gives up quietly.
//
//   <img src={adminPreview(src)} use:retryImage alt="" />

const DELAYS = [700, 1800, 4000];

export function retryImage(node: HTMLImageElement) {
	let attempt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const onError = () => {
		const src = node.getAttribute('src') ?? '';
		// blob:/data: URLs are already in memory — a retry can only fail again.
		if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
		if (attempt >= DELAYS.length) return;
		const wait = DELAYS[attempt++];
		timer = setTimeout(() => {
			// A cache-busting param is the point: without it the browser serves the
			// failure it already cached rather than asking again.
			const base = src.split('#')[0].replace(/([?&])_retry=\d+&?/, '$1').replace(/[?&]$/, '');
			node.src = `${base}${base.includes('?') ? '&' : '?'}_retry=${attempt}`;
		}, wait);
	};

	// A successful load means whatever came before is forgiven — a later failure
	// (a changed src, say) gets its own full run of retries.
	const onLoad = () => {
		attempt = 0;
	};

	node.addEventListener('error', onError);
	node.addEventListener('load', onLoad);

	return {
		destroy() {
			clearTimeout(timer);
			node.removeEventListener('error', onError);
			node.removeEventListener('load', onLoad);
		}
	};
}
