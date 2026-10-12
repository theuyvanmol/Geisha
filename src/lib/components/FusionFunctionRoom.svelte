<script lang="ts">
	// Fusion "Parties & Functions" page: editorial hero, a venue-style room card,
	// an occasion picker with the polaroid collage, and the enquiry form.
	// The form logic (POST /api/contact, honeypot, sending/error/thanks states) and
	// the editable copy from Content → Pages → Parties are the same as PartiesPanel,
	// which the Asia page still uses. Photos and the doorway video live in static/images/functions/.
	// The ambient layer is Fusion's ring cluster; it was falling sakura petals, which are Asia's.
	import { onMount } from 'svelte';
	import type { Brand } from '$lib/data/brand';
	import type { PagesContent, BrandInfoContent } from '$lib/content/schema';
	import { getPagesDefaults, fillTokens, tokenSource } from '$lib/data/pages';
	import RichText from './RichText.svelte';

	let {
		brand,
		copy,
		brandInfo
	}: {
		brand: Brand;
		copy?: PagesContent['parties'];
		brandInfo?: BrandInfoContent;
	} = $props();

	const c = $derived(copy ?? getPagesDefaults(brand.id).parties);
	const tok = $derived(tokenSource(brand, brandInfo));
	const fill = (s: string) => fillTokens(s, tok);

	const phone = $derived(tok.phone || '0191 300 4641');
	const phoneHref = $derived('tel:' + phone.replace(/[^\d+]/g, ''));
	const ADDRESS = 'Geisha Fusion, Front Street, Benton, Newcastle Upon Tyne NE12 8AE';
	const EMAIL = 'fusion@geisharestaurants.co.uk';

	const occasions = $derived(
		c.occasions.length ? c.occasions : getPagesDefaults(brand.id).parties.occasions
	);
	const leadWords = $derived(fill(c.lead).split(/\s+/).filter(Boolean));

	let form = $state({ name: '', email: '', phone: '', date: '', size: '', occasion: '', message: '' });
	let submitted = $state(false);
	let sending = $state(false);
	let sendError = $state('');
	// Honeypot: off-screen rather than display:none, which bots skip.
	let website = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (sending) return;
		sending = true;
		sendError = '';
		try {
			const res = await fetch('/api/contact', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					brand: brand.id,
					kind: 'parties',
					name: form.name,
					email: form.email,
					phone: form.phone,
					date: form.date,
					partySize: form.size,
					occasion: form.occasion,
					message: form.message,
					website
				})
			});
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				sendError =
					(b && typeof b.message === 'string' && b.message) ||
					`Sorry — your enquiry could not be sent. Please call us on ${tok.phone}.`;
				return;
			}
			submitted = true;
		} catch {
			sendError = `Sorry — your enquiry could not be sent. Please call us on ${tok.phone}.`;
		} finally {
			sending = false;
		}
	}

	let root: HTMLElement;
	let hero: HTMLElement;
	let occasionSelect: HTMLSelectElement;
	let door: HTMLElement;
	let video: HTMLVideoElement;
	let armed = $state(false);
	let played = $state(false);

	function pickOccasion(o: string) {
		form.occasion = o;
		document.getElementById('enquire')?.scrollIntoView({ behavior: 'smooth' });
		setTimeout(() => occasionSelect?.focus({ preventScroll: true }), 700);
	}

	onMount(() => {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const cleanups: (() => void)[] = [];

		/* scroll-in animations: everything is visible until JS arms the page */
		if (!reduce && 'IntersectionObserver' in window) {
			armed = true;
			requestAnimationFrame(() => requestAnimationFrame(() => (played = true)));
			const io = new IntersectionObserver(
				(es) =>
					es.forEach((e) => {
						if (e.isIntersecting) {
							e.target.classList.add('in');
							io.unobserve(e.target);
						}
					}),
				{ rootMargin: '0px 0px -12% 0px' }
			);
			root.querySelectorAll('[data-anim]').forEach((el) => io.observe(el));
			cleanups.push(() => io.disconnect());

			/* gentle parallax on the framed photos */
			const pars = [...root.querySelectorAll<HTMLElement>('[data-parallax]')];
			let ticking = false;
			const onScroll = () => {
				if (ticking) return;
				ticking = true;
				requestAnimationFrame(() => {
					const vh = innerHeight;
					/* the hero's ring cluster opens out as the hero scrolls away — the
					   same gesture, on the same clock, as the home page hero's */
					const hr = hero.getBoundingClientRect();
					hero.style.setProperty('--hp', Math.min(1, Math.max(0, -hr.top / (hr.height || vh))).toFixed(4));
					for (const el of pars) {
						const r = el.parentElement!.getBoundingClientRect();
						if (r.bottom < 0 || r.top > vh) continue;
						const p = (r.top + r.height / 2 - vh / 2) / vh;
						el.style.setProperty('--py', `${(p * -40).toFixed(1)}px`);
					}
					ticking = false;
				});
			};
			addEventListener('scroll', onScroll, { passive: true });
			onScroll();
			cleanups.push(() => removeEventListener('scroll', onScroll));
		}

		/* doorway: map scroll position through the pinned section to door/grow/copy progress */
		const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
		const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
		const setDoor = (open: number, grow: number, copyP: number) => {
			door.style.setProperty('--open', open.toFixed(4));
			door.style.setProperty('--grow', grow.toFixed(4));
			door.style.setProperty('--copy', copyP.toFixed(4));
		};
		if (reduce) setDoor(1, 1, 1);
		else {
			let dTick = false;
			const onDoor = () => {
				if (dTick) return;
				dTick = true;
				requestAnimationFrame(() => {
					const r = door.getBoundingClientRect();
					const total = Math.max(1, r.height - innerHeight);
					const p = clamp01(-r.top / total);
					setDoor(easeOut(clamp01((p - 0.04) / 0.42)), easeOut(clamp01((p - 0.18) / 0.45)), easeOut(clamp01((p - 0.55) / 0.3)));
					dTick = false;
				});
			};
			addEventListener('scroll', onDoor, { passive: true });
			addEventListener('resize', onDoor);
			onDoor();
			cleanups.push(() => { removeEventListener('scroll', onDoor); removeEventListener('resize', onDoor); });
		}
		/* only play the video while the doorway is on screen */
		const vio = new IntersectionObserver((es) => {
			if (es[0].isIntersecting) video.play().catch(() => {});
			else video.pause();
		});
		vio.observe(door);
		cleanups.push(() => vio.disconnect());

		return () => cleanups.forEach((fn) => fn());
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;600&family=Jost:wght@300;400;500&display=swap" />
</svelte:head>

<div class="fn" class:armed class:played bind:this={root}>
	<!-- HERO -->
	<section class="hero" bind:this={hero}>
		<!-- Fusion's ring cluster, not falling petals: petals are Geisha Asia's motif
		     (owner, Oct 2026). Same drawing as the home page's hero. -->
		<svg class="rings" viewBox="0 0 600 600" aria-hidden="true">
			<circle cx="300" cy="300" r="290" fill="none" stroke="#dd8236" stroke-width="1" />
			<circle cx="300" cy="300" r="215" fill="none" stroke="#5a9184" stroke-width="1" />
			<circle cx="300" cy="300" r="140" fill="none" stroke="#f79a4a" stroke-width="1" />
		</svg>
		<div class="wrap">
			<div class="hero-copy">
				<h1>
					<span class="eyebrow">{fill(c.title)} · Geisha Fusion</span>
					<span class="lead">
						{#each leadWords as w, i}<span class="w"><span style="--i:{i}">{w}</span></span>{' '}{/each}
					</span>
				</h1>
				<div class="rule up" style="--i:6" aria-hidden="true"><i></i></div>
				<div class="intro up" style="--i:7"><p><RichText text={fill(c.intro)} autolink /></p></div>
				<div class="actions up" style="--i:8">
					<a class="btn solid" href="#enquire"><span>Make an enquiry</span><span class="arr"></span></a>
					<a class="btn" href={phoneHref}><span>Call {phone}</span></a>
					{#if c.leafletUrl}
						<a class="btn" href={c.leafletUrl} target="_blank" rel="noopener noreferrer"><span>{c.leafletLabel || 'Private hire leaflet'} ↓</span></a>
					{/if}
				</div>
			</div>
			<div class="hero-art">
				<div class="frame main" data-anim="reveal">
					<img data-parallax src="/images/functions/mural-booths.webp" alt="The function room: curved booth seating beneath a painted mural and hanging blossom" width="1080" height="1080" />
				</div>
				<span class="vert" aria-hidden="true">Function Room</span>
			</div>
		</div>
	</section>

	<!-- DOORWAY: two lacquered doors open onto the room as you scroll -->
	<section class="doorway" bind:this={door} aria-label="Step inside the function room">
		<div class="stage">
			<p class="hint" aria-hidden="true">Scroll to step inside</p>
			<div class="dcopy dcopy-l">
				<span class="eyebrow">Step inside</span>
				<h2>The Function Room</h2>
			</div>
			<div class="portal">
				<div class="opening">
					<video bind:this={video} src="/images/functions/function-room.mp4" poster="/images/functions/function-room-poster.webp" muted loop playsinline preload="metadata" aria-hidden="true"></video>
					<div class="veil"></div>
					<div class="leaf leaf-l" aria-hidden="true"><span class="panel"></span><span class="panel"></span><span class="ring"></span><img class="dcrest" src="/images/brand/geisha-g.webp" alt="" width="394" height="600" /></div>
					<div class="leaf leaf-r" aria-hidden="true"><span class="panel"></span><span class="panel"></span><span class="ring"></span><img class="dcrest" src="/images/brand/geisha-g.webp" alt="" width="394" height="600" /></div>
				</div>
				<span class="portal-frame" aria-hidden="true"></span>
			</div>
			<div class="dcopy dcopy-r">
				<p>Booths beneath the blossom, chandeliers overhead and a room that’s yours for the night.</p>
				<a class="btn solid" href="#enquire"><span>Enquire</span><span class="arr"></span></a>
			</div>
		</div>
	</section>

	<!-- OCCASION MARQUEE -->
	<div class="marquee" aria-hidden="true">
		<div class="track">
			{#each [0, 1] as _}
				<span class="run">{#each occasions as o}<span>{o}</span><i></i>{/each}</span>
			{/each}
		</div>
	</div>

	<!-- THE ROOM -->
	<section class="venue" aria-labelledby="room-title">
		<div class="wrap">
			<div class="flip" data-anim="flip">
				<div class="flip-card">
					<div class="flip-back" aria-hidden="true">
						<img class="crest" src="/images/brand/geisha-g.webp" alt="" width="394" height="600" />
					</div>
					<div class="frame photo flip-front">
						<img data-parallax src="/images/functions/eighteenth.webp" alt="The function room dressed for an 18th birthday" width="1080" height="1080" loading="lazy" />
					</div>
				</div>
			</div>
			<div class="venue-info">
				<span class="eyebrow up-s" data-anim="rise">The room</span>
				<h2 id="room-title" class="up-s" data-anim="rise">The Function Room</h2>
				<div class="contact-lines up-s" data-anim="rise">
					<span>{ADDRESS}</span>
					<a href={phoneHref}>{phone}</a>
					<a href="mailto:{EMAIL}">{EMAIL}</a>
				</div>
				<div class="traits">
					<h3 class="up-s" data-anim="rise">What’s included</h3>
					<ul>
						{#each ['Stylish decor under the blossom', 'A proper sound system', 'Versatile lighting', 'Help with decorations', 'Help arranging entertainment', 'Our team on hand all night'] as t, i}
							<li class="up-s" data-anim="rise" style="--d:{i * 70}ms">{t}</li>
						{/each}
					</ul>
				</div>
				<div class="actions up-s" data-anim="rise">
					<a class="btn solid" href="#enquire"><span>Enquire</span><span class="arr"></span></a>
					<a class="btn" href="/fusion/menus"><span>View menus</span></a>
				</div>
			</div>
		</div>
	</section>

	<!-- OCCASIONS -->
	<section class="occasions" aria-labelledby="occ-title">
		<div class="wrap">
			<div class="occ-head">
				<span class="eyebrow up-s" data-anim="rise">Celebrations of every kind</span>
				<h2 id="occ-title" class="up-s" data-anim="rise">What are we celebrating?</h2>
				<p class="up-s" data-anim="rise">Pick your occasion and we’ll add it to your enquiry.</p>
			</div>
			<div class="collage" data-anim="drop">
				<img src="/images/functions/collage.webp" alt="Three snapshots from the function room: a family party with balloons, a booth set for an 18th, and the mural dining room" width="1200" height="533" loading="lazy" />
			</div>
			<ul class="occ-list">
				{#each occasions as o, i}
					<li class="up-s" data-anim="rise" style="--d:{(i % 4) * 60 + Math.floor(i / 4) * 40}ms">
						<button type="button" onclick={() => pickOccasion(o)}><span>{o}</span><i></i></button>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<!-- ENQUIRY -->
	<section class="enquire" id="enquire" aria-labelledby="enq-title">
		<div class="wrap">
			<div class="enq-art">
				<div class="frame photo" data-anim="reveal">
					<img data-parallax src="/images/functions/baby-shower.webp" alt="A guest at her baby shower beside a welcome sign" width="1080" height="1080" loading="lazy" />
				</div>
				<p class="up-s" data-anim="rise">From the welcome sign to the last balloon, our team can help with decorations and entertainment.</p>
			</div>
			<div>
				<div class="form-head">
					<span class="eyebrow up-s" data-anim="rise">Private hire</span>
					<h2 id="enq-title" class="up-s" data-anim="rise">{fill(c.enquiryHeading)}</h2>
				</div>
				{#if submitted}
					<p class="thanks"><RichText text={fill(c.thanks)} autolink /></p>
				{:else}
					<form onsubmit={submit}>
						<div class="field up-s" data-anim="rise"><label for="fn-name">Name</label><input id="fn-name" type="text" autocomplete="name" bind:value={form.name} required /></div>
						<div class="field up-s" data-anim="rise" style="--d:60ms"><label for="fn-email">Email</label><input id="fn-email" type="email" autocomplete="email" bind:value={form.email} required /></div>
						<div class="field up-s" data-anim="rise"><label for="fn-phone">Phone</label><input id="fn-phone" type="tel" autocomplete="tel" bind:value={form.phone} /></div>
						<div class="field up-s" data-anim="rise" style="--d:60ms"><label for="fn-date">Preferred date</label><input id="fn-date" type="date" bind:value={form.date} /></div>
						<div class="field up-s" data-anim="rise"><label for="fn-size">Party size</label><input id="fn-size" type="number" min="1" inputmode="numeric" placeholder="e.g. 30" bind:value={form.size} /></div>
						<div class="field up-s" data-anim="rise" style="--d:60ms">
							<label for="fn-occasion">Occasion</label>
							<select id="fn-occasion" bind:this={occasionSelect} bind:value={form.occasion}>
								<option value="" disabled>Choose…</option>
								{#each occasions as o}<option value={o}>{o}</option>{/each}
							</select>
						</div>
						<div class="field full up-s" data-anim="rise"><label for="fn-more">Tell us more</label><textarea id="fn-more" rows="4" placeholder="Timings, food, decorations, anything we should know" bind:value={form.message}></textarea></div>
						<!-- Honeypot: off-screen rather than display:none, which bots skip. Kept
						     out of the tab order and the accessibility tree. -->
						<div class="hp" aria-hidden="true">
							<label>Website<input type="text" bind:value={website} tabindex="-1" autocomplete="off" /></label>
						</div>
						<div class="submit-row up-s" data-anim="rise">
							<button class="btn solid" type="submit" disabled={sending}><span>{sending ? 'Sending…' : 'Send enquiry'}</span><span class="arr"></span></button>
						</div>
						{#if sendError}<p class="senderr" role="alert">{sendError}</p>{/if}
					</form>
				{/if}
				<p class="alt"><RichText text={fill(c.altLine)} autolink /></p>
			</div>
		</div>
	</section>
</div>

<style>
	/* Editorial hero → marquee → venue card (portrait photo that flips in) → occasions
	   with the collage → photo-led enquiry form. Geisha palette, single dark look. */
	.fn {
		--lacquer: #0c1410;
		--ink: #0a0d0b;
		--rice: #f2ece0;
		--sage: #9fb0a8;
		--ember: #dd8236;
		--sky: #5ba3f0;
		--hair: rgba(242, 236, 224, 0.22);
		--mincho: 'Shippori Mincho', Georgia, 'Times New Roman', serif;
		--jost: 'Jost', system-ui, sans-serif;
		--ease: cubic-bezier(0.215, 0.61, 0.355, 1);
		--spring: cubic-bezier(0.3, 1.3, 0.6, 1);
		background: var(--lacquer);
		color: var(--rice);
		font-family: var(--jost);
		font-weight: 300;
		font-size: 16px;
		line-height: 1.65;
		overflow-x: clip;
	}
	.fn :global(a) { color: inherit; }
	img { display: block; max-width: 100%; }
	.wrap { max-width: 1240px; margin: 0 auto; padding-inline: clamp(16px, 5vw, 64px); }
	.eyebrow { display: block; font-family: var(--jost); font-size: 11px; font-weight: 400; letter-spacing: 0.32em; text-transform: uppercase; color: var(--ember); }
	h1, h2, h3 { font-family: var(--mincho); font-weight: 600; margin: 0; text-wrap: balance; }
	.rule { display: flex; align-items: center; gap: 14px; color: var(--hair); }
	.rule::before, .rule::after { content: ''; width: 48px; height: 1px; background: currentColor; }
	.rule i { width: 8px; height: 8px; background: var(--ember); transform: rotate(45deg); }

	/* buttons: a fill rises from the bottom on hover */
	.btn { position: relative; overflow: hidden; isolation: isolate; display: inline-flex; align-items: center; gap: 12px; font-family: var(--jost); font-size: 11.5px; font-weight: 500; letter-spacing: 0.24em; text-transform: uppercase; text-decoration: none; padding: 16px 26px; border: 1px solid var(--rice); border-radius: 2px; background: transparent; color: var(--rice); cursor: pointer; transition: color 0.45s var(--ease), border-color 0.45s var(--ease); }
	.btn::before { content: ''; position: absolute; inset: 0; z-index: -1; background: var(--rice); transform: translateY(101%); transition: transform 0.55s var(--ease); }
	.btn:hover, .btn:focus-visible { color: var(--ink); outline: none; }
	.btn:hover::before, .btn:focus-visible::before { transform: none; }
	.btn.solid { background: var(--ember); border-color: var(--ember); color: var(--ink); }
	.btn.solid:hover, .btn.solid:focus-visible { border-color: var(--rice); }
	.btn:disabled { opacity: 0.6; cursor: progress; }
	.arr { width: 22px; height: 1px; background: currentColor; position: relative; transition: width 0.45s var(--ease); }
	.arr::after { content: ''; position: absolute; right: 0; top: -3px; width: 7px; height: 7px; border-top: 1px solid currentColor; border-right: 1px solid currentColor; transform: rotate(45deg); }
	.btn:hover .arr { width: 34px; }

	.frame { position: relative; border-radius: 3px; overflow: hidden; }
	.frame::after { content: ''; position: absolute; inset: 12px; border: 1px solid rgba(242, 236, 224, 0.45); pointer-events: none; }
	.frame img { position: absolute; left: 0; top: -7.5%; width: 100%; height: 115%; max-width: none; object-fit: cover; transform: translateY(var(--py, 0px)); will-change: transform; }

	/* HERO */
	.hero { position: relative; overflow: hidden; padding-block: clamp(72px, 9vw, 128px) clamp(72px, 8vw, 112px); background: radial-gradient(50% 60% at 85% 20%, rgba(221, 130, 54, 0.08), transparent 70%), var(--lacquer); }
	/* Hung off the hero's left edge, behind the copy. --hp (0 parked → 1 scrolled past)
	   widens it; the fallbacks are the resting state, also the reduced-motion one. */
	.rings {
		position: absolute; left: -12%; top: 50%; translate: 0 -50%;
		width: min(720px, 60vw); height: min(720px, 60vw);
		pointer-events: none;
		opacity: calc(0.24 - var(--hp, 0) * 0.1);
		transform: scale(calc(1 + var(--hp, 0) * 0.3));
		transform-origin: 50% 50%;
		will-change: transform;
	}
	.hero .wrap { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: clamp(40px, 6vw, 96px); align-items: center; }
	.hero-copy { display: flex; flex-direction: column; gap: 24px; align-items: flex-start; }
	h1 { display: flex; flex-direction: column; gap: 22px; }
	.lead { font-size: clamp(44px, 6vw, 84px); line-height: 1.04; letter-spacing: 0.005em; }
	.lead .w { display: inline-block; overflow: hidden; vertical-align: top; padding-bottom: 0.08em; }
	.lead .w > span { display: inline-block; }
	.lead .w:nth-last-child(-n + 2) > span { color: var(--sky); }
	.intro :global(p), .intro p { margin: 0; max-width: 46ch; color: rgba(242, 236, 224, 0.82); }
	.actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; }
	.hero-art { position: relative; margin-right: clamp(0px, 3vw, 40px); }
	.hero-art .main { aspect-ratio: 7 / 9; max-width: 100%; }
	.hero-art .main img { object-position: 30% center; }
	.vert { position: absolute; right: -6px; top: 8%; writing-mode: vertical-rl; font-family: var(--mincho); font-size: 13px; letter-spacing: 0.6em; color: var(--sage); text-transform: uppercase; transform: translateX(100%); }

	/* DOORWAY */
	.doorway { position: relative; height: 280vh; background: var(--ink); border-bottom: 1px solid var(--hair); --open: 0; --grow: 0; --copy: 0; }
	.stage { position: sticky; top: 0; height: 100vh; height: 100svh; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: clamp(24px, 4vw, 72px); padding-inline: clamp(16px, 5vw, 64px); background: radial-gradient(40% 60% at 50% 50%, rgba(221, 130, 54, 0.1), transparent 70%), var(--ink); }
	.hint { position: absolute; left: 0; right: 0; bottom: 28px; margin: 0; text-align: center; font-size: 10.5px; letter-spacing: 0.32em; text-transform: uppercase; color: var(--sage); opacity: calc(1 - var(--open) * 3); pointer-events: none; }
	.portal { position: relative; height: calc(100% - 48px); aspect-ratio: 9 / 16; max-width: 100%; transform: scale(calc(0.62 + 0.38 * var(--grow))); }
	.opening { position: absolute; inset: 0; overflow: hidden; border-radius: 2px; perspective: 1400px; background: var(--lacquer); }
	.opening video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: brightness(calc(0.35 + 0.65 * var(--open))); transform: scale(calc(1.12 - 0.12 * var(--open))); }
	.veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10, 13, 11, 0.25), transparent 30%, transparent 70%, rgba(10, 13, 11, 0.35)); pointer-events: none; }
	/* border-box, at every width: the page has no global reset, so `width: 50%` plus the 12% side
	   padding made each leaf 74% of the doorway. The two overlapped, the seam sat a quarter of the
	   way across and only half the crest showed. */
	.leaf { box-sizing: border-box; position: absolute; top: 0; bottom: 0; width: 50%; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; gap: 6%; padding: 9% 12%; backface-visibility: hidden; -webkit-backface-visibility: hidden;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.02), transparent 40%), repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.012) 0 2px, transparent 2px 7px), #0e1712; box-shadow: inset 0 0 0 1px rgba(242, 236, 224, 0.12); }
	.leaf-l { left: 0; transform-origin: left center; transform: rotateY(calc(var(--open) * -104deg)); }
	.leaf-r { right: 0; transform-origin: right center; transform: rotateY(calc(var(--open) * 104deg)); }
	.panel { flex: 1; border: 1px solid rgba(221, 130, 54, 0.4); box-shadow: inset 0 0 0 6px rgba(0, 0, 0, 0.18), inset 0 0 0 7px rgba(242, 236, 224, 0.1); border-radius: 1px; }
	.panel:first-child { flex: 1.35; }
	.ring { position: absolute; top: 54%; width: 14px; height: 14px; border: 1.5px solid rgba(221, 130, 54, 0.85); border-radius: 50%; }
	.leaf-l .ring { right: 9%; }
	.leaf-r .ring { left: 9%; }
	.dcrest { position: absolute; top: 32%; width: 48%; height: auto; max-width: none; opacity: 0.92; }
	.leaf-l .dcrest { right: -24%; }
	.leaf-r .dcrest { left: -24%; }
	.portal-frame { position: absolute; inset: -14px; border: 1px solid rgba(242, 236, 224, 0.45); border-radius: 3px; opacity: calc(1 - var(--grow)); pointer-events: none; }
	.dcopy { display: flex; flex-direction: column; gap: 18px; opacity: var(--copy); transition: none; }
	.dcopy-l { align-items: flex-end; text-align: right; transform: translateX(calc((1 - var(--copy)) * -40px)); }
	.dcopy-l h2 { font-size: clamp(34px, 4.2vw, 64px); line-height: 1.04; }
	.dcopy-r { align-items: flex-start; transform: translateX(calc((1 - var(--copy)) * 40px)); }
	.dcopy-r p { margin: 0; max-width: 28ch; color: rgba(242, 236, 224, 0.82); }
	@media (max-width: 900px) {
		/* border-box: the block padding used to be ADDED to the 100svh, so the pinned stage was
		   104px taller than the screen and its bottom row (the "scroll" hint, then the Enquire
		   button) sat below the fold for the whole pin. Top padding clears the scrolled top bar
		   (67px on a tablet; the phone block below has its own figure); the rest is kept tight
		   so the doorway gets every pixel left over. */
		.stage { box-sizing: border-box; grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr) auto; justify-items: center; padding-block: 82px 24px; gap: 14px; }
		.portal { height: 100%; }
		.dcopy { gap: 14px; }
		.dcopy-r p { max-width: 34ch; font-size: 15px; line-height: 1.55; }
		.dcopy-l, .dcopy-r { align-items: center; text-align: center; transform: translateY(calc((1 - var(--copy)) * 16px)); }
		.dcopy-l h2 { font-size: clamp(28px, 8vw, 40px); }
		.hint { bottom: 12px; }
	}
	@media (prefers-reduced-motion: reduce) {
		.doorway { height: auto; }
		.stage { position: relative; }
		.leaf { display: none; }
	}

	/* MARQUEE */
	.marquee { overflow: hidden; border-block: 1px solid var(--hair); background: var(--ink); padding-block: 20px; }
	.track { display: flex; width: max-content; animation: marquee 60s linear infinite; }
	.run { display: flex; align-items: center; gap: 34px; padding-right: 34px; font-family: var(--mincho); font-size: clamp(18px, 2vw, 26px); color: rgba(242, 236, 224, 0.75); white-space: nowrap; }
	.run i { width: 7px; height: 7px; background: var(--ember); transform: rotate(45deg); }
	@keyframes marquee { to { transform: translateX(-50%); } }

	/* THE ROOM */
	.venue { padding-block: clamp(72px, 9vw, 128px); background: var(--ink); border-bottom: 1px solid var(--hair); }
	.venue .wrap { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1fr); gap: clamp(40px, 6vw, 96px); align-items: center; }
	.flip { perspective: 2000px; }
	.flip-card { position: relative; aspect-ratio: 7 / 10; max-width: 100%; transform-style: preserve-3d; }
	.flip-front { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
	.flip-front img { object-position: 62% center; }
	.flip-back { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; border-radius: 3px; border: 1px solid var(--hair); background: radial-gradient(70% 50% at 50% 35%, rgba(221, 130, 54, 0.1), transparent 70%), var(--lacquer); backface-visibility: hidden; -webkit-backface-visibility: hidden; transform: rotateY(180deg) translateZ(1px); }
	.flip-back::before { content: ''; position: absolute; inset: 12px; border: 1px solid rgba(221, 130, 54, 0.45); border-radius: 2px; }
	.crest { width: min(110px, 32%); height: auto; opacity: 0.95; }
	
	.venue-info { display: flex; flex-direction: column; gap: 22px; min-width: 0; }
	.venue h2 { font-size: clamp(36px, 4.4vw, 60px); line-height: 1.05; }
	.contact-lines { display: flex; flex-direction: column; gap: 2px; color: var(--sage); font-size: 15px; }
	.contact-lines a { text-decoration: none; border-bottom: 1px solid var(--hair); width: fit-content; }
	.contact-lines a:hover { border-color: var(--rice); color: var(--rice); }
	.traits { border-top: 1px solid var(--hair); padding-top: 22px; }
	.traits h3 { font-family: var(--jost); font-weight: 500; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--ember); margin-bottom: 14px; }
	.traits ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 28px; }
	.traits li { display: flex; gap: 12px; align-items: baseline; }
	.traits li::before { content: ''; flex: none; width: 6px; height: 6px; background: var(--ember); transform: rotate(45deg) translateY(-2px); }

	/* OCCASIONS */
	.occasions { padding-block: clamp(80px, 10vw, 140px); }
	.occ-head { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 18px; max-width: 640px; margin: 0 auto clamp(40px, 5vw, 64px); }
	.occ-head h2 { font-size: clamp(34px, 4.2vw, 56px); line-height: 1.08; }
	.occ-head p { margin: 0; color: var(--sage); }
	.collage { max-width: 980px; margin: 0 auto clamp(48px, 6vw, 80px); }
	.collage img { width: 100%; height: auto; filter: drop-shadow(0 24px 40px rgba(0, 0, 0, 0.5)); }
	.occ-list { list-style: none; margin: 0 auto; padding: 0; max-width: 980px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--hair); }
	.occ-list li { border-bottom: 1px solid var(--hair); }
	.occ-list button { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 18px 14px; background: none; border: 0; color: var(--rice); font-family: var(--mincho); font-size: 17px; text-align: left; cursor: pointer; transition: color 0.35s var(--ease), background 0.35s var(--ease), padding 0.35s var(--ease); }
	.occ-list button i { width: 18px; height: 1px; background: currentColor; opacity: 0; transform: translateX(-8px); transition: 0.35s var(--ease); }
	.occ-list button:hover, .occ-list button:focus-visible { color: var(--ember); background: rgba(242, 236, 224, 0.03); padding-left: 20px; outline: none; }
	.occ-list button:hover i, .occ-list button:focus-visible i { opacity: 1; transform: none; }

	/* ENQUIRY */
	.enquire { padding-block: clamp(80px, 10vw, 140px); background: var(--ink); border-top: 1px solid var(--hair); }
	.enquire .wrap { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1fr); gap: clamp(40px, 6vw, 96px); align-items: start; }
	.enq-art { position: sticky; top: 96px; display: flex; flex-direction: column; gap: 18px; }
	.enq-art .photo { aspect-ratio: 4 / 5; max-width: 100%; }
	.enq-art .photo img { object-position: center 30%; }
	.enq-art p { margin: 0; color: var(--sage); font-size: 15px; max-width: 40ch; }
	.form-head { display: flex; flex-direction: column; gap: 14px; margin-bottom: 32px; }
	.form-head h2 { font-size: clamp(34px, 4vw, 52px); line-height: 1.05; }
	form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px 28px; }
	.field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
	.field.full { grid-column: 1 / -1; }
	label { font-size: 10.5px; font-weight: 500; letter-spacing: 0.26em; text-transform: uppercase; color: var(--sage); }
	input, select, textarea { width: 100%; font: inherit; font-size: 16px; color: var(--rice); background: transparent; border: 0; border-bottom: 1px solid var(--hair); padding: 10px 0 12px; border-radius: 0; transition: border-color 0.35s var(--ease); }
	select { appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--sage) 50%), linear-gradient(-45deg, transparent 50%, var(--sage) 50%); background-position: calc(100% - 10px) 55%, calc(100% - 5px) 55%; background-size: 5px 5px; background-repeat: no-repeat; }
	select option { background: var(--ink); color: var(--rice); }
	textarea { min-height: 110px; resize: vertical; }
	input:focus, select:focus, textarea:focus { outline: none; border-color: var(--ember); }
	input::placeholder, textarea::placeholder { color: rgba(159, 176, 168, 0.5); }
	input[type='date']::-webkit-calendar-picker-indicator { filter: invert(0.8); }
	.submit-row { grid-column: 1 / -1; margin-top: 6px; }
	.senderr { grid-column: 1 / -1; margin: 0; padding: 14px 16px; border-left: 2px solid #e06a5a; background: rgba(224, 106, 90, 0.08); }
	.thanks { margin: 0; padding: 22px 24px; border-left: 2px solid var(--ember); background: rgba(221, 130, 54, 0.07); font-family: var(--mincho); font-size: 20px; }
	.alt { margin: 28px 0 0; color: var(--sage); font-size: 15px; }
	.hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

	/* ---------- motion: only once JS has armed the page ---------- */
	.armed .lead .w > span { transform: translateY(110%); transition: transform 1.1s var(--ease); transition-delay: calc(var(--i) * 70ms + 150ms); }
	.armed.played .lead .w > span { transform: none; }
	.armed .up { opacity: 0; transform: translateY(18px); transition: opacity 1s var(--ease), transform 1s var(--ease); transition-delay: calc(var(--i) * 90ms + 200ms); }
	.armed.played .up { opacity: 1; transform: none; }

	.armed [data-anim='reveal'] { clip-path: inset(100% 0 0 0); transition: clip-path 1.5s var(--ease); }
	.armed [data-anim='reveal'] img { scale: 1.25; transition: scale 2.4s var(--ease); }
	.armed [data-anim='reveal']:global(.in) { clip-path: inset(0 0 0 0); }
	.armed [data-anim='reveal']:global(.in) img { scale: 1; }

	.armed .up-s { opacity: 0; transform: translateY(22px); transition: opacity 0.9s var(--ease), transform 0.9s var(--ease); transition-delay: var(--d, 0ms); }
	.armed .up-s:global(.in) { opacity: 1; transform: none; }

	.armed [data-anim='flip'] .flip-card { transform: translateY(40px) rotateY(-180deg); transition: transform 2s var(--spring); }
	.armed [data-anim='flip']:global(.in) .flip-card { transform: none; }

	.armed [data-anim='drop'] { opacity: 0; transform: translateY(80px) rotate(-5deg) scale(0.92); transition: opacity 0.9s var(--ease), transform 1.6s var(--spring); }
	.armed [data-anim='drop']:global(.in) { opacity: 1; transform: none; }

	@media (max-width: 900px) {
		.hero .wrap, .venue .wrap, .enquire .wrap { grid-template-columns: 1fr; }
		.hero-art { max-width: 520px; margin-right: 0; }
		.vert { display: none; }
		.flip-card { max-width: 520px; }
		/* Stacked, the form goes first. Every "Enquire" button and every occasion in the picker
		   scrolls to #enquire; with the photo on top that landed on a 440px picture and left the
		   form (and the occasion just chosen) a full screen further down. */
		.enq-art { position: static; order: 2; }
		.occ-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
	@media (max-width: 560px) {
		form { grid-template-columns: 1fr; }
		.traits ul { grid-template-columns: 1fr; }

		/* ---------- phone ---------- */
		/* Small caps: 12px is the floor on a phone (these were 10.5–11.5px). The tracking comes in
		   to pay for it, so the hero eyebrow still fits one line at 360px. */
		.eyebrow { font-size: 12px; letter-spacing: 0.22em; }
		.traits h3 { font-size: 12px; letter-spacing: 0.22em; }
		label { font-size: 12px; letter-spacing: 0.22em; }
		.hint { font-size: 12px; letter-spacing: 0.26em; }
		.btn { font-size: 12px; padding-inline: 20px; justify-content: center; }

		/* Hero: less air above the eyebrow (the top bar is right there), and the two calls to
		   action as one full-width pair instead of a 233px button over a 213px one. */
		.hero { padding-block: 44px 56px; }
		.hero .wrap { gap: 36px; }
		.hero-copy { gap: 20px; }
		h1 { gap: 16px; }
		.hero .actions { flex-direction: column; align-self: stretch; }

		/* Doorway: the scrolled top bar is 54px on a phone. */
		.stage { padding-block: 66px 22px; }

		/* The room. At 36px "The Function Room" broke with "Room" alone on a second line. */
		.venue { padding-block: 56px 64px; }
		.venue .wrap { gap: 36px; }
		.venue h2 { font-size: clamp(28px, 8.6vw, 36px); }
		/* Phone and email were two 25px links 2px apart. Space them and grow the hit area. */
		.contact-lines { gap: 12px; }
		.contact-lines a { position: relative; }
		.contact-lines a::before { content: ''; position: absolute; inset: -6px -8px; }
		.venue .actions .btn { flex: 1 1 0; }

		/* Occasions. The collage is a 1200px-wide strip: held to the text column each polaroid was
		   barely 100px across, so it runs to the screen edges (the picture has its own margin). */
		.occasions { padding-block: 64px 72px; }
		.occ-head { gap: 14px; margin-bottom: 28px; }
		.collage { margin-inline: calc(-1 * clamp(16px, 5vw, 64px)); margin-bottom: 36px; }
		/* No hover on a phone, so the arrow only ever cost the label 28px and pushed "Private
		   dining" onto two lines; and a tapped button must not keep the hover indent. */
		.occ-list button, .occ-list button:hover, .occ-list button:focus-visible { padding-inline: 12px; }
		.occ-list button i { display: none; }

		/* Enquiry. */
		.enq-art { margin-top: 12px; }
		.submit-row .btn { width: 100%; }
		/* iOS draws an empty date field shorter than its neighbours and centres its value. */
		input[type='date'] { min-height: 1.65em; }
		input::-webkit-date-and-time-value { text-align: left; }
	}
	@media (prefers-reduced-motion: reduce) {
		.track { animation: none; }
		.frame img { transform: none; }
	}
</style>
