<!--
  HomeCards.svelte — three 3D flip cards that unveil on scroll. It stands where the
  Gallery teaser used to on both home pages (it began as FusionCards, on /fusion only).
  The ambient layer behind the cards is each house's own: falling sakura petals on
  Asia, the ring clusters on Fusion. Petals are Asia's motif and never Fusion's (owner,
  Oct 2026); the rings are the ones Fusion's hero, story and menu sections already carry.
  Images live in static/images/cards/ (1200 x 1800 WebP); the card backs use static/images/brand/geisha-g.webp.
  Fonts: uses Shippori Mincho + Jost, already loaded by the site.
-->
<script lang="ts">
  import './showcase/type.css'; // Gang of Three, for the titles on Asia's cards
  import { onMount } from 'svelte';
  import type { Brand, BrandId } from '$lib/data/brand';

  let { brand }: { brand: Brand } = $props();

  // The heading block. Each house's wording is its own home page copy (the hero
  // eyebrow and the Our Story headline in $lib/data/home.ts), not new claims.
  const HEAD: Record<BrandId, { eyebrow: string; title: string; accent: string; lede: string }> = {
    asia: {
      eyebrow: 'Modern Pan-Asian Cuisine',
      title: 'Rooted in tradition,',
      accent: 'crafted for today',
      lede: 'Sushi, sashimi and dim sum in a Japanese garden-inspired dining room, open every day from midday in the heart of Benton.'
    },
    fusion: {
      eyebrow: 'Global Flavours · Family Table',
      title: 'One kitchen,',
      accent: 'every craving',
      lede: 'Burgers, curry, stone-baked pizza and a proper Sunday roast, open seven days on Front Street, Benton.'
    }
  };
  const head = $derived(HEAD[brand.id]);

  // Each house has its OWN three cards: its own artwork and its own menus (owner,
  // Oct 2026 — Asia briefly showed Fusion's three, which advertise a festive menu
  // Asia does not have).
  //
  //   Fusion  cover artwork with the title lettered into the picture, so the
  //           heading is for screen readers only.
  //   Asia    has no cover artwork: its printed menus are text sheets. Its cards are
  //           portrait crops of its own banners (the Daytime Special artwork, the
  //           hero portrait, the gift card set, each cut to 2:3),
  //           so the title is set over the picture in Gang of Three, the face of
  //           Asia's menu headings. `lettered: false` is what switches that on.
  //
  // Menu names, times and prices here repeat $lib/data/offers.ts and
  // menus.asia.ts — change them there first.
  type Card = { img: string; alt: string; tag: string; title: string; link: string; href: string; lettered: boolean };
  const CARDS: Record<BrandId, Card[]> = {
    asia: [
      {
        img: '/images/cards/asia-daytime-special.webp',
        alt: 'A geisha in a red kimono before a red sun, from the Daytime Special artwork',
        tag: 'Mon–Fri, 12pm – 5pm · £15',
        title: 'Daytime Special',
        link: 'View the daytime special',
        href: '/asia/menus/daytime-special',
        lettered: false
      },
      {
        img: '/images/cards/asia-main-menu.webp',
        alt: 'A woman in a black floral kimono against a gold disc and red blossom',
        tag: 'Sushi · Dim sum · Robata',
        title: 'Main Menu',
        link: 'Explore the main menu',
        href: '/asia/menus',
        lettered: false
      },
      {
        img: '/images/cards/asia-gift-vouchers.webp',
        alt: 'Two black Geisha gift cards tied with a gold ribbon and bow',
        tag: 'From £25 · Sent by email',
        title: 'Gift Vouchers',
        link: 'Buy a gift voucher',
        href: '/asia/gift-cards',
        lettered: false
      }
    ],
    fusion: [
      {
        img: '/images/cards/christmas-menu.webp',
        alt: 'Festive Christmas Menu artwork: a painted geisha face beside Christmas greenery, baubles and gifts',
        tag: 'What’s On · Christmas',
        title: 'Christmas Festive Menu',
        link: 'View the festive menu',
        href: '/fusion/offers',
        lettered: true
      },
      {
        img: '/images/cards/main-menu.webp',
        alt: 'Main Menu artwork: a painted geisha portrait among cherry blossom on cream paper',
        tag: 'New for the season',
        title: 'New Main Menu',
        link: 'Explore the main menu',
        href: '/fusion/menus',
        lettered: true
      },
      {
        img: '/images/cards/gift-vouchers.webp',
        alt: 'Give the perfect gift this Christmas: a Geisha gift voucher with a gold ribbon in the restaurant',
        tag: 'Use at Fusion or Asia',
        title: 'Christmas Gift Vouchers',
        link: 'Buy a gift voucher',
        href: '/fusion/gift-cards',
        lettered: true
      }
    ]
  };
  const cards = $derived(CARDS[brand.id]);

  let section: HTMLElement;
  let canvas: HTMLCanvasElement | undefined = $state();

  onMount(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The stylesheet's phone breakpoint, where the cards are a row you swipe.
    const phone = matchMedia('(max-width: 600px)').matches;
    const cleanups: (() => void)[] = [];

    /* ---------- the unveil: rotateY -180 -> 0 with a small overshoot, staggered ---------- */
    if (!reduce) {
      // On a phone a flick lands on the first card cold, and the others turn as they
      // are swiped in. The turn is quicker there: face-on in about 0.2s and settled
      // in 1.4s, where the desktop row of three takes 2s.
      const turn = phone ? 1400 : 2000;
      const stagger = phone ? 140 : 220;
      const io = new IntersectionObserver(
        (entries) => {
          const entering = entries.filter((e) => e.isIntersecting).map((e) => e.target);
          entering.forEach((el, i) => {
            const card = el.querySelector<HTMLElement>('.card')!;
            const img = el.querySelector<HTMLElement>('.scene')!;
            const delay = i * stagger;
            card.animate(
              [
                { transform: 'translateY(40px) rotateY(-180deg)' },
                { transform: 'translateY(0) rotateY(0deg)' }
              ],
              { duration: turn, delay, easing: 'cubic-bezier(.3, 1.28, .6, 1)', fill: 'both' }
            ).finished.then(() => card.classList.remove('is-hidden'));
            img.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], {
              duration: turn * 1.3, delay: delay + 250, easing: 'cubic-bezier(.215,.61,.355,1)', fill: 'backwards'
            });
            io.unobserve(el);
          });
        },
        { rootMargin: '0px 0px -28% 0px' }
      );
      // Only the cards still to come start face-down: those below the trigger line,
      // and on a phone those off to the side of the row. Decided one frame after
      // mount, by when SvelteKit has put the scroll position back: coming Back from a
      // card's own page (or reloading part-way down) lands on this section, and the
      // cards already on screen used to turn their backs and flip all over again.
      const arm = requestAnimationFrame(() => {
        const line = innerHeight * 0.72; // the observer's -28% bottom margin
        section.querySelectorAll<HTMLElement>('.twister').forEach((t) => {
          const r = t.getBoundingClientRect();
          if (r.top < line && r.left < innerWidth && r.right > 0) return;
          t.querySelector('.card')!.classList.add('is-hidden');
          io.observe(t);
        });
      });
      cleanups.push(() => { cancelAnimationFrame(arm); io.disconnect(); });
    }

    /* ---------- gentle pointer tilt (desktop only, separate layer from the flip) ---------- */
    if (!reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      section.querySelectorAll<HTMLElement>('.tilt').forEach((t) => {
        const move = (e: PointerEvent) => {
          const r = t.getBoundingClientRect();
          t.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`);
          t.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 6}deg`);
        };
        const leave = () => { t.style.setProperty('--ry', '0deg'); t.style.setProperty('--rx', '0deg'); };
        t.addEventListener('pointermove', move);
        t.addEventListener('pointerleave', leave);
        cleanups.push(() => { t.removeEventListener('pointermove', move); t.removeEventListener('pointerleave', leave); });
      });
    }

    /* ---------- Fusion: the ring clusters widen as the section crosses the screen ----------
       Same gesture as the cluster behind Fusion's Our Story: --p runs 0 → 1 from the
       section's top reaching the bottom edge to its bottom clearing the top, and the
       CSS turns that into scale + opacity. Left unset under reduced motion, where the
       rings rest at their fallback size.
       --p is written on the two ring clusters, its only readers — not on the section,
       where every card would inherit it and be restyled on each scroll frame — and
       only while the section is near the screen (it clamps to 0 or 1 as it leaves). */
    if (!canvas) {
      if (!reduce) {
        const rings = section.querySelectorAll<SVGElement>('.rings');
        let tick = 0;
        let near = true;
        const track = () => {
          tick = 0;
          const r = section.getBoundingClientRect();
          const vh = innerHeight || 1;
          const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height))).toFixed(4);
          rings.forEach((el) => el.style.setProperty('--p', p));
        };
        const onScroll = () => { if (near && !tick) tick = requestAnimationFrame(track); };
        const gate = new IntersectionObserver(
          ([e]) => { near = e.isIntersecting; if (!tick) tick = requestAnimationFrame(track); },
          { rootMargin: '25% 0px' }
        );
        gate.observe(section);
        track();
        addEventListener('scroll', onScroll, { passive: true });
        addEventListener('resize', onScroll, { passive: true });
        cleanups.push(() => { gate.disconnect(); cancelAnimationFrame(tick); removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); });
      }
      return () => cleanups.forEach((fn) => fn());
    }

    /* ---------- Asia: sakura petals ---------- */
    const cv = canvas;
    const ctx = cv.getContext('2d')!;
    let W = 0, H = 0, visible = true, raf = 0;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const tones = ['#fbe3e8', '#f4c6cf', '#eaa9b8'];
    const newPetal = (anywhere: boolean) => ({
      x: rand(-40, W), y: anywhere ? rand(-H * 0.1, H) : rand(-60, -20),
      r: rand(5, 11), vy: rand(0.35, 0.9), vx: rand(0.15, 0.55),
      sway: rand(0.6, 1.6), phase: rand(0, Math.PI * 2), spin: rand(-0.012, 0.012),
      rot: rand(0, Math.PI * 2), flip: rand(0.01, 0.03), f: rand(0, Math.PI * 2),
      tone: tones[Math.floor(Math.random() * tones.length)], a: rand(0.55, 0.9)
    });
    type Petal = ReturnType<typeof newPetal>;
    let petals: Petal[] = [];
    const size = () => {
      // The bitmap is the section's own box, repainted every frame it is on screen.
      // A phone gets it at 1.5x rather than 2x: soft drifting shapes lose nothing, and
      // it is 44% fewer pixels to clear and upload each frame.
      const dpr = Math.min(devicePixelRatio || 1, phone ? 1.5 : 2);
      W = section.clientWidth; H = section.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Half as many on a phone: the section is one screen tall there, not two and a
      // half, and the full count on it was twice as thick as the same fall on a desktop.
      const n = reduce ? 14 : Math.round(Math.min(46, W / 32) * (phone ? 0.5 : 1));
      petals = Array.from({ length: n }, () => newPetal(true));
      // Resizing the bitmap wipes it. With motion reduced nothing repaints, and the
      // ResizeObserver below always reports once on its own, so the still petals were
      // drawn and then cleared for good.
      if (reduce) frame(0);
    };
    const drawPetal = (p: Petal) => {
      const r = p.r;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(Math.cos(p.f) * 0.9 + 0.1 * Math.sign(Math.cos(p.f) || 1), 1);
      ctx.globalAlpha = p.a;
      const g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, p.tone); g.addColorStop(1, '#fff4f6');
      ctx.fillStyle = g;
      ctx.beginPath(); // cherry-blossom petal with a notched tip
      ctx.moveTo(0, r);
      ctx.bezierCurveTo(-r * 1.05, r * 0.35, -r * 0.85, -r * 0.75, -r * 0.22, -r);
      ctx.lineTo(0, -r * 0.72);
      ctx.lineTo(r * 0.22, -r);
      ctx.bezierCurveTo(r * 0.85, -r * 0.75, r * 1.05, r * 0.35, 0, r);
      ctx.fill();
      ctx.restore();
    };
    const frame = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      for (const p of petals) {
        if (!reduce) {
          p.y += p.vy; p.x += p.vx + Math.sin((t / 1400) * p.sway + p.phase) * 0.45;
          p.rot += p.spin; p.f += p.flip;
          if (p.y > H + 30 || p.x > W + 40) Object.assign(p, newPetal(false));
        }
        drawPetal(p);
      }
      // The loop ends here once the section is off screen (it used to keep ticking and
      // only skip the drawing); the observer below starts it again.
      raf = !reduce && visible ? requestAnimationFrame(frame) : 0;
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(section);
    const vis = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf && !reduce) raf = requestAnimationFrame(frame);
    });
    vis.observe(section);
    if (!reduce) raf = requestAnimationFrame(frame);
    cleanups.push(() => { cancelAnimationFrame(raf); ro.disconnect(); vis.disconnect(); });

    return () => cleanups.forEach((fn) => fn());
  });
</script>

<section class="home-cards" data-brand={brand.id} bind:this={section} aria-labelledby="home-cards-title">
  {#if brand.id === 'asia'}
    <canvas class="petals" bind:this={canvas} aria-hidden="true"></canvas>
  {:else}
    <!-- Fusion's ring clusters: the same three-circle drawing its hero, story and
         menu sections use, one hung off each top corner's opposite. -->
    <svg class="rings rings-a" viewBox="0 0 600 600" aria-hidden="true">
      <circle cx="300" cy="300" r="290" fill="none" stroke="#dd8236" stroke-width="1" />
      <circle cx="300" cy="300" r="210" fill="none" stroke="#5a9184" stroke-width="1" />
      <circle cx="300" cy="300" r="132" fill="none" stroke="#f79a4a" stroke-width="1" />
    </svg>
    <svg class="rings rings-b" viewBox="0 0 600 600" aria-hidden="true">
      <circle cx="300" cy="300" r="290" fill="none" stroke="#dd8236" stroke-width="1" />
      <circle cx="300" cy="300" r="205" fill="none" stroke="#f79a4a" stroke-width="1" />
    </svg>
  {/if}

  <header class="head">
    <span class="eyebrow">{head.eyebrow}</span>
    <h2 id="home-cards-title">{head.title} <em>{head.accent}</em></h2>
    <div class="rule" aria-hidden="true"><svg viewBox="0 0 14 14"><path d="M7 1 13 7 7 13 1 7Z" fill="currentColor" /></svg></div>
    <p>{head.lede}</p>
  </header>

  <div class="grid">
    {#each cards as c}
      <div class="twister">
        <div class="tilt">
          <a class="card" class:titled={!c.lettered} href={c.href}>
            <div class="back" aria-hidden="true">
              <img class="brand" src="/images/brand/geisha-g.webp" alt="" width="394" height="600" />
            </div>
            <div class="front">
              <div class="imagebox">
                <img class="scene" src={c.img} alt={c.alt} width="1200" height="1800" loading="lazy" decoding="async" />
                <div class="scrim"></div>
              </div>
              <div class="inset"></div>
              <div class="copy">
                <span class="tag">{c.tag}</span>
                <h3 class={c.lettered ? 'sr-only' : 'title'}>{c.title}</h3>
                <span class="go">{c.link} <i></i></span>
              </div>
            </div>
          </a>
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  /* Fusion's palette is the default; Asia's block below swaps the same roles for its
     own tokens (the ink, gold and sakura its hero and Our Story sections carry). */
  .home-cards {
    --lacquer: #0c1410;
    --ink: #0a0d0b;
    --rice: #f2ece0;
    --sage: #9fb0a8;
    --ember: #dd8236;
    --ember-rgb: 221, 130, 54;
    --sky: #5ba3f0;
    --wash-2: rgba(91, 163, 240, 0.06);
    --hair: rgba(242, 236, 224, 0.28);
    --mincho: 'Shippori Mincho', Georgia, 'Times New Roman', serif;
    --jost: 'Jost', system-ui, sans-serif;
    --ease: cubic-bezier(0.215, 0.61, 0.355, 1);
    --radius: 6px;

    position: relative;
    overflow: hidden;
    padding: clamp(96px, 10vw, 150px) clamp(16px, 5vw, 80px) clamp(80px, 8vw, 120px);
    color: var(--rice);
    font-family: var(--jost);
    font-weight: 300;
    background:
      radial-gradient(60% 50% at 50% 0%, rgba(var(--ember-rgb), 0.07), transparent 70%),
      radial-gradient(40% 40% at 0% 100%, var(--wash-2), transparent 70%),
      var(--lacquer);
  }
  .home-cards[data-brand='asia'] {
    --lacquer: #131316;
    --ink: #08080b;
    --rice: #f5f1e8;
    --sage: #a3a0a0;
    --ember: #d4af37;
    --ember-rgb: 212, 175, 55;
    --sky: #ff7a94;
    --wash-2: rgba(239, 60, 92, 0.07);
    --hair: rgba(245, 241, 232, 0.24);
  }
  .petals { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
  /* The ring clusters. Each scales about its own centre on --p (see the script), so
     it reads as the rings widening rather than the drawing sliding; the fallbacks
     are the resting size, which is also the reduced-motion state. */
  .rings {
    position: absolute; z-index: 0; pointer-events: none;
    opacity: calc(0.12 + var(--p, 0.5) * 0.16);
    transform: scale(calc(0.7 + var(--p, 0.5) * 0.6));
    transform-origin: 50% 50%;
    will-change: transform;
  }
  .rings-a { left: -11%; top: -12%; width: min(640px, 54vw); height: min(640px, 54vw); }
  .rings-b { right: -14%; bottom: -16%; width: min(560px, 46vw); height: min(560px, 46vw); }
  .head, .grid { position: relative; z-index: 1; }

  .head { max-width: 640px; margin: 0 auto clamp(48px, 6vw, 80px); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .eyebrow { font-size: 11px; font-weight: 400; letter-spacing: 0.32em; text-transform: uppercase; color: var(--ember); }
  .head h2 { margin: 0; font-family: var(--mincho); font-weight: 600; font-size: clamp(34px, 4.2vw, 58px); line-height: 1.08; text-wrap: balance; }
  .head h2 em { font-style: normal; color: var(--sky); }
  .head p { margin: 0; max-width: 48ch; color: var(--sage); line-height: 1.6; }
  .rule { display: flex; align-items: center; gap: 14px; color: var(--hair); }
  .rule::before, .rule::after { content: ''; width: 56px; height: 1px; background: currentColor; }
  .rule svg { width: 14px; height: 14px; color: var(--ember); }

  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(20px, 2.6vw, 44px); max-width: 1280px; margin: 0 auto; }

  .twister { perspective: 2000px; }
  .tilt { transform-style: preserve-3d; transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform 0.8s var(--ease); }
  .card { position: relative; display: block; height: min(68vh, 640px); min-height: 480px; border-radius: var(--radius); transform-style: preserve-3d; color: inherit; text-decoration: none; }
  .card:global(.is-hidden) { transform: translateY(40px) rotateY(-180deg); }

  .back {
    position: absolute; inset: 0; border-radius: var(--radius);
    backface-visibility: hidden; -webkit-backface-visibility: hidden;
    transform: rotateY(180deg) translateZ(45px);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px;
    background:
      radial-gradient(70% 50% at 50% 35%, rgba(var(--ember-rgb),0.1), transparent 70%),
      repeating-linear-gradient(115deg, rgba(255, 255, 255, 0.012) 0 2px, transparent 2px 9px),
      var(--ink);
    border: 1px solid var(--hair);
  }
  .back::before { content: ''; position: absolute; inset: 12px; border-radius: var(--radius); border: 1px solid rgba(var(--ember-rgb),0.45); }
  .brand { width: min(104px, 30%); height: auto; opacity: 0.95; }

  .front { position: relative; height: 100%; border-radius: var(--radius); transform-style: preserve-3d; }
  .front::after { content: ''; position: absolute; inset: 0; border-radius: var(--radius); border: 1px solid var(--hair); pointer-events: none; }
  .imagebox {
    position: absolute; top: -1.2%; left: -1.2%; width: 102.4%; height: 102.4%;
    border-radius: var(--radius); overflow: hidden; overflow: clip; background: var(--ink);
    backface-visibility: hidden; -webkit-backface-visibility: hidden; transform: translateZ(-40px);
  }
  .scene { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 40%; transition: transform 1.4s var(--ease); }
  .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 0%, transparent 72%, rgba(10, 13, 11, 0.55) 84%, rgba(10, 13, 11, 0.9) 100%); }
  .inset { position: absolute; inset: 14px; border-radius: var(--radius); border: 1px solid transparent; transform: translateZ(20px) scale(0.97); transition: transform 0.9s var(--ease), border-color 0.9s var(--ease); pointer-events: none; }

  .copy {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 0 clamp(20px, 2.4vw, 36px) clamp(22px, 2.4vw, 32px);
    text-align: center; transform: translateZ(40px);
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  /* A card whose picture carries no lettering: the title is set here, in the house's
     own menu face, and the scrim comes further up the picture to seat it. */
  .title {
    margin: 0;
    font-family: 'Gang of Three', var(--mincho);
    font-weight: 400;
    font-size: clamp(30px, 2.9vw, 44px);
    line-height: 1.04;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    text-wrap: balance;
    color: #fff;
    text-shadow: 0 2px 26px rgba(0, 0, 0, 0.7);
  }
  .titled .scrim { background: linear-gradient(180deg, transparent 0%, transparent 44%, rgba(8, 8, 11, 0.62) 68%, rgba(8, 8, 11, 0.95) 100%); }
  .titled .copy { gap: 12px; }
  .titled .scene { object-position: center 30%; }
  .tag { font-size: 10.5px; font-weight: 400; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ember); }
  .go { margin-top: 4px; display: inline-flex; align-items: center; gap: 12px; font-size: 11px; font-weight: 500; letter-spacing: 0.28em; text-transform: uppercase; }
  .go i { position: relative; display: block; width: 28px; height: 1px; background: var(--rice); transition: width 0.6s var(--ease); }
  .go i::after { content: ''; position: absolute; right: 0; top: -3px; width: 7px; height: 7px; border-top: 1px solid var(--rice); border-right: 1px solid var(--rice); transform: rotate(45deg); }
  .sr-only { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  @media (hover: hover) and (pointer: fine) {
    .card:hover .scene { transform: scale(1.07); }
    .card:hover .inset { border-color: rgba(242, 236, 224, 0.55); transform: translateZ(20px) scale(1); }
    .card:hover .go i { width: 56px; }
  }
  .card:focus-visible { outline: none; }
  .card:focus-visible .front::after { border-color: var(--ember); box-shadow: 0 0 0 3px rgba(var(--ember-rgb),0.45); }

  @media (max-width: 1023px) {
    .grid { grid-template-columns: 1fr; max-width: 460px; }
    .card { height: 560px; min-height: 0; }
  }
  /* ---------- phones ---------- */
  @media (max-width: 600px) {
    /* Both home pages run a 20px gutter and ~70px between sections on a phone; the fluid clamps above gave 18–21px and 96px. */
    .home-cards {
      padding: 72px 20px 70px;
      /* The two washes are sized in percentages of the section: pools of light on a wide desktop row, but on a
         tall, narrow phone column they stretched into a stripe down the middle and another up the left edge, each
         cut off square where the section meets its neighbour. Fixed pools instead, placed so they have faded out
         before the section's own edge.
         And no flat lacquer under them on a phone: the ground is the page's own gradient showing through from
         HomeSections, the only place this component is used. The lacquer is within a few levels of it, but flat,
         so the section ended in a visible step against the reviews below it (and on Fusion against What's On above,
         cutting the big ambient ring in half). */
      background:
        radial-gradient(circle 300px at 50% 210px, rgba(var(--ember-rgb), 0.07), transparent 70%),
        radial-gradient(circle 280px at 0% calc(100% - 200px), var(--wash-2), transparent 70%);
    }
    .head { gap: 14px; margin-bottom: 32px; }
    /* One colour to a line. At 34px "Rooted in tradition," is 318px wide: it fits a 390 screen by a hair and
       not a 360 one, where the heading re-broke into three lines with the colour change mid-line. */
    .head h2 { font-size: min(34px, 8.8vw); }
    .head h2 em { display: block; }
    /* Three even lines instead of two and "Benton." on its own. */
    .head p { text-wrap: balance; }

    /* ---- The three cards sit in a row you swipe, not a stack you scroll. ----
       Stacked, the section was 2,031px on a 390 x 844 phone: 2.4 screens of thumb travel, the longest stretch on
       either home page after the hero. In a row it is ~860px, and the heading, one whole card and the edge of the
       next make a single screen. Each card keeps the poster's 2:3 shape (see below) and still turns over as it
       comes into view — the observer in the script counts the row's own clipping, so the third card turns when it
       is swiped in.
       - The row runs out to the screen edges (the negative side margins undo the section's gutter) and
         scroll-padding snaps a card back onto the gutter.
       - overflow-y is `hidden`, not the `auto` that overflow-x would imply: the row must never be scrollable up and
         down, or a vertical swipe that starts on a card would be spent on it instead of the page. The 28px / 56px of
         block padding (taken back by the margins) is room for a card mid-turn, which stands ~20px taller in
         perspective and starts 40px low; without it the turn was cropped top and bottom. */
    .grid {
      --card-w: min(80vw, 380px);
      display: flex;
      gap: 14px;
      max-width: none;
      margin: -28px -20px -56px;
      padding: 28px 20px 56px;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      scroll-padding-inline: 20px;
      overscroll-behavior-x: contain;
      touch-action: pan-x pan-y;
      scrollbar-width: none;
    }
    .grid::-webkit-scrollbar { display: none; }
    .twister { flex: 0 0 var(--card-w); scroll-snap-align: start; }
    /* The artwork is a 2:3 poster with its own lettering set close to the edge; any other shape and `cover` shaves
       the sides (it cut the S off "THIS CHRISTMAS"). The height is stated from the width rather than with
       aspect-ratio — .front is height: 100% and needs a definite height to resolve against. 468px at 390: a whole
       card fits a phone screen with Safari's toolbars up. */
    .card { height: calc(var(--card-w) * 1.5); }
    /* The card is ~40px narrower than the stack was. The longest lines ("Daytime Special" in the title face,
       "View the daytime special" and its arrow) are brought in to stay on one line down to a 360 screen. */
    .copy { padding-inline: 16px; }
    .title { font-size: min(30px, 8vw); }
    /* The tag sits 88% down the card, where the ramp above is still only ~60% ink: ember caps on mid-grey over the
       cream poster and on the gold bow of the voucher one. Same foot, firmed up sooner, so both lines stand on dark. */
    .scrim { background: linear-gradient(180deg, transparent 0%, transparent 70%, rgba(10, 13, 11, 0.5) 79%, rgba(10, 13, 11, 0.86) 87%, rgba(10, 13, 11, 0.94) 100%); }
    /* Asia's cards set their title over the picture and keep their own, taller scrim (the rule above is for the
       lettered posters and never reaches them). Firmed up the same way: the gold tag sits 75–79% down the card,
       where that ramp was still ~70% ink over the bronze bow of the voucher artwork. */
    .titled .scrim { background: linear-gradient(180deg, transparent 0%, transparent 42%, rgba(8, 8, 11, 0.6) 62%, rgba(8, 8, 11, 0.86) 76%, rgba(8, 8, 11, 0.96) 100%); }
    /* 10.5px and 11px tracked caps were the smallest type on the page. */
    .tag { font-size: 11px; }
    .go { font-size: clamp(10.5px, 3.2vw, 12px); letter-spacing: 0.2em; gap: 10px; white-space: nowrap; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tilt, .scene, .inset, .go i { transition: none; }
  }
</style>
