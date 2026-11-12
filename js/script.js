/*
 * Tanmoy Biswas — portfolio
 *
 * Plain JavaScript, with GSAP + ScrollTrigger (self-hosted in js/vendor) for
 * motion. No build step.
 *
 * The page is complete without this file. Each init* function finds its own
 * markup, adds one enhancement, and returns early when that markup, a browser
 * feature, or GSAP is missing. Content is never hidden by CSS waiting on this
 * file, except the hero intro, which has a CSS failsafe (see [data-intro]).
 *
 * Performance rules followed throughout:
 *  - Pointer-driven motion uses gsap.quickTo: one reusable tween per property,
 *    nothing allocated per pointer event.
 *  - Layout is read once and cached (on resize), never inside a frame loop.
 *  - Continuous loops (the ticker here, the WebGL terrain in terrain.js) stop
 *    when they are off screen or the tab is hidden.
 */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Environment and helpers
   * ------------------------------------------------------------------ */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const scriptUrl = document.currentScript?.src;

  const { gsap, ScrollTrigger, Lenis } = window;
  const hasGsap = Boolean(gsap && ScrollTrigger);
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);

  /** True when GSAP is available and the visitor has not asked for less motion. */
  const animate = hasGsap && !reducedMotion.matches;

  /** The smooth-scroll engine, once initSmoothScroll has started it. */
  let lenis = null;

  /** Values the Three.js modules read every frame; ScrollTriggers here write them. */
  const heroScroll = { progress: 0 };   // 0..1 as the hero scrolls away
  const storyState = { morph: 0 };      // 0..2 through the pinned story

  /** Scroll to an element, leaving room for the fixed navigation bar. */
  function scrollToElement(el) {
    if (lenis) {
      lenis.scrollTo(el, { offset: -parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop || '0') });
    } else {
      el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  /** Run `callback` at most once per animation frame, however often it is requested. */
  function oncePerFrame(callback) {
    let queued = false;
    return (...args) => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        callback(...args);
      });
    };
  }

  /**
   * Recalculate ScrollTrigger positions after the page height changes
   * (filters, accordion rows). Debounced so a burst of changes costs one refresh.
   */
  const refreshScroll = (() => {
    let timer = 0;
    return () => {
      if (!hasGsap) return;
      clearTimeout(timer);
      timer = setTimeout(() => ScrollTrigger.refresh(), 350);
    };
  })();

  /** Read and write a single query-string value without adding history entries. */
  const query = {
    get: (key) => new URLSearchParams(location.search).get(key),
    set(key, value) {
      const params = new URLSearchParams(location.search);
      if (value) params.set(key, value);
      else params.delete(key);
      const search = params.toString();
      history.replaceState(null, '', location.pathname + (search ? `?${search}` : '') + location.hash);
    },
  };

  /** Small status message at the bottom of the screen; also read out by screen readers. */
  const toast = (() => {
    let timer = 0;
    return (message) => {
      const el = $('[data-toast]');
      if (!el) return;
      el.textContent = message;
      el.classList.add('is-on');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('is-on'), 2200);
    };
  })();

  /**
   * Wrap each word (by: 'word') or each character (by: 'char') of an element's
   * text in a span, leaving nested tags such as <em> in place. Returns the spans.
   */
  function splitText(root, by) {
    const spans = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const node of textNodes) {
      const parts = by === 'char' ? [...node.textContent] : node.textContent.split(/(\s+)/);
      // In highlighted text (<em>) the space after each word goes inside the word,
      // as a no-break space, so the highlight runs on without gaps; a <wbr> after
      // it keeps the line-break opportunity the plain space provided.
      const highlighted = by === 'word' && node.parentElement.closest('em');
      const fragment = document.createDocumentFragment();

      parts.forEach((part, index) => {
        if (!part.trim()) {
          if (part && !highlighted) fragment.append(part); // whitespace stays plain text so lines still wrap
          return;
        }
        const span = document.createElement('span');
        span.textContent = part;
        if (by === 'char') {
          span.className = 'ch';
          fragment.append(span);
        } else {
          const followed = highlighted && parts.slice(index + 1).some((next) => next.trim());
          if (followed) span.textContent += ' ';
          // Words get an outer clipping box and an inner span that slides up into it.
          const box = document.createElement('span');
          box.className = 'w';
          box.append(span);
          fragment.append(box);
          if (followed) fragment.append(document.createElement('wbr'));
        }
        spans.push(span);
      });
      node.replaceWith(fragment);
    }
    return spans;
  }

  /* ------------------------------------------------------------------ *
   * Hero intro
   *
   * The first name rises letter by letter, the lime slab wipes in behind
   * the surname before its letters rise, and the portrait card opens from
   * the bottom. Returns the letters (for the hover effect) and a play()
   * function: the timeline waits for the preloader to leave.
   * ------------------------------------------------------------------ */

  function initIntro() {
    const hero = $('[data-hero]');
    const name = hero && $('[data-kinetic]', hero);
    if (!name) return { letters: [], play() {} };

    // Screen readers get the name once, not letter by letter.
    name.setAttribute('aria-label', name.textContent.replace(/\s+/g, ' ').trim());
    const lines = $$('.line', name).map((line) => {
      line.setAttribute('aria-hidden', 'true');
      return splitText(line, 'char');
    });
    name.classList.add('is-split');

    const parts = $$('[data-intro]', hero);
    const finish = () => name.classList.add('is-ready');

    if (!animate) {
      parts.forEach((el) => { el.style.opacity = '1'; });
      finish();
      return { letters: lines.flat(), play() {} };
    }

    const [first = [], last = []] = lines;
    const slab = $('.line:last-child > span', name);
    const visual = $('.hero__visual', hero);
    const portrait = $('.hero__portrait', hero);
    const fades = [$('.hero__meta', hero), $('.hero__foot', hero)].filter(Boolean);

    // Inline opacity overrides the CSS that hid these pieces until now.
    gsap.set(parts, { opacity: 1 });

    const intro = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' }, onComplete: finish })
      .from(first, { yPercent: 115, duration: 1, stagger: 0.035 }, 0)
      .fromTo(slab, { '--slab': 0 }, { '--slab': 1, duration: 0.7, ease: 'power4.inOut' }, 0.2)
      .from(last, { yPercent: 115, duration: 1, stagger: 0.035 }, 0.45)
      .from(visual, { clipPath: 'inset(100% 0% 0% 0% round 12px)', duration: 1.1, ease: 'expo.inOut', clearProps: 'clipPath' }, 0.1)
      .from(portrait, { scale: 1.18, yPercent: 6, duration: 1.4 }, 0.35)
      .from(fades, { autoAlpha: 0, y: 18, duration: 0.8, stagger: 0.1, ease: 'power3.out' }, 0.55);

    return { letters: lines.flat(), play: () => intro.play() };
  }

  /* ------------------------------------------------------------------ *
   * Preloader: a lime panel counts to 100 while fonts and the portrait
   * arrive, then wipes upward and hands over to the hero intro. It plays
   * once per session and never holds the page for more than ~2 seconds.
   * ------------------------------------------------------------------ */

  function initLoader(onDone) {
    const loader = $('[data-loader]');
    const skip = !loader || !animate || document.documentElement.classList.contains('no-loader');
    if (skip) {
      loader?.remove();
      onDone();
      return;
    }
    try { sessionStorage.setItem('tb-visited', '1'); } catch { /* private mode: it just plays again */ }

    const root = document.documentElement;
    root.style.overflow = 'hidden';
    lenis?.stop();

    const count = $('[data-loader-count]', loader);
    const counter = { value: 0 };
    const counted = new Promise((resolve) => {
      gsap.to(counter, {
        value: 100,
        duration: 1.2,
        ease: 'power2.inOut',
        onUpdate: () => { count.textContent = Math.round(counter.value); },
        onComplete: resolve,
      });
    });
    // Ready when the fonts and the portrait are in, but never wait on them for long.
    const portrait = $('.hero__portrait img');
    const ready = Promise.race([
      Promise.all([document.fonts?.ready, portrait?.decode?.().catch(() => {})]),
      new Promise((resolve) => setTimeout(resolve, 1800)),
    ]);

    Promise.all([counted, ready]).then(() => {
      gsap.to(loader, {
        yPercent: -100,
        duration: 0.9,
        ease: 'expo.inOut',
        onComplete: () => {
          loader.remove();
          root.style.overflow = '';
          lenis?.start();
        },
      });
      gsap.delayedCall(0.35, onDone);
    });
  }

  /* ------------------------------------------------------------------ *
   * Smooth scrolling (Lenis). Wheel and trackpad scrolling glide to a stop
   * instead of stepping; touch scrolling stays native. Lenis runs on GSAP's
   * ticker and reports every scroll to ScrollTrigger, so all scroll-linked
   * animation stays in step with it.
   * ------------------------------------------------------------------ */

  function initSmoothScroll() {
    if (!animate || !Lenis) return;
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  /* ------------------------------------------------------------------ *
   * Cursor follower: a small inverting dot that trails the pointer and
   * grows into a labelled lime disc over anything marked [data-cursor-text].
   * ------------------------------------------------------------------ */

  function initCursor() {
    const cursor = $('[data-cursor]');
    if (!cursor) return;
    if (!animate || !finePointer.matches) {
      cursor.remove();
      return;
    }

    const label = $('[data-cursor-label]', cursor);
    const toX = gsap.quickTo(cursor, 'x', { duration: 0.35, ease: 'power3.out' });
    const toY = gsap.quickTo(cursor, 'y', { duration: 0.35, ease: 'power3.out' });
    let visible = false;

    window.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      if (!visible) {
        // Appear under the pointer instead of gliding in from the corner.
        toX(event.clientX, event.clientX);
        toY(event.clientY, event.clientY);
        cursor.classList.add('is-visible');
        visible = true;
      }
      toX(event.clientX);
      toY(event.clientY);

      const text = event.target.closest?.('[data-cursor-text]')?.dataset.cursorText ?? '';
      if (text !== label.textContent) {
        label.textContent = text;
        cursor.classList.toggle('has-label', Boolean(text));
      }
    }, { passive: true });

    document.documentElement.addEventListener('pointerleave', () => {
      cursor.classList.remove('is-visible');
      visible = false;
    });
  }

  /* ------------------------------------------------------------------ *
   * Pinned story: the section holds still for a few screens while three
   * captions take turns and the particle scene (js/story.js) morphs
   * between shapes. The timeline here owns the timing; the scene only
   * reads storyState.morph.
   * ------------------------------------------------------------------ */

  function initStory() {
    const section = $('[data-story]');
    if (!section) return;
    const stage = $('[data-story-stage]', section);
    const steps = $$('.story__step', section);
    const bar = $('[data-story-bar]', section);

    if (animate && stage && steps.length === 3) {
      section.classList.add('is-pinned');
      gsap.set(steps.slice(1), { autoAlpha: 0, y: 40 });

      // Timeline units are arbitrary; the scrub maps all 3 of them onto the pinned distance.
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=260%',
          pin: stage,
          scrub: 0.8,
          refreshPriority: 1, // measure the pin before anything below it
        },
      })
        .to(bar, { scaleY: 1, duration: 3 }, 0)
        .to(storyState, { morph: 1, duration: 0.8, ease: 'power1.inOut' }, 0.6)
        .to(steps[0], { autoAlpha: 0, y: -40, duration: 0.3 }, 0.75)
        .to(steps[1], { autoAlpha: 1, y: 0, duration: 0.3 }, 1.05)
        .to(storyState, { morph: 2, duration: 0.8, ease: 'power1.inOut' }, 1.75)
        .to(steps[1], { autoAlpha: 0, y: -40, duration: 0.3 }, 1.9)
        .to(steps[2], { autoAlpha: 1, y: 0, duration: 0.3 }, 2.2);
    }

    // The 3D scene loads when the section comes within ~600px of the viewport.
    const canvas = $('[data-story-canvas]', section);
    if (!canvas || !scriptUrl) return;
    new IntersectionObserver((entries, observer) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      import(new URL('story.js', scriptUrl).href)
        .then(({ mountStory }) => mountStory(canvas, { gsap, state: storyState, still: !animate }))
        .catch((error) => console.warn('Story scene unavailable:', error));
    }, { rootMargin: '600px 0px' }).observe(section);
  }

  /* ------------------------------------------------------------------ *
   * Footer: the giant name rises letter by letter as the page ends.
   * ------------------------------------------------------------------ */

  function initFooterName() {
    const name = $('[data-footer-name]');
    if (!name) return;
    const letters = splitText(name, 'char');
    if (!animate) return;

    gsap.from(letters, {
      yPercent: 110,
      ease: 'none',
      stagger: 0.05,
      scrollTrigger: { trigger: name, start: 'top bottom', end: 'bottom bottom', scrub: 0.6 },
    });
  }

  /* ------------------------------------------------------------------ *
   * Hero name: letters near the pointer lift, then settle back.
   * ------------------------------------------------------------------ */

  function initLetterHover(letters) {
    const name = $('[data-kinetic]');
    const hero = name?.closest('[data-hero]');
    if (!hero || !letters.length || !animate || !finePointer.matches) return;

    const lifts = letters.map((el) => gsap.quickTo(el, 'y', { duration: 0.55, ease: 'power3.out' }));
    let centres = [];
    let lift = 0;
    let reach = 1;

    // Letter centres relative to the heading box, measured with their lift removed.
    function measure() {
      const box = name.getBoundingClientRect();
      const fontSize = parseFloat(getComputedStyle(name).fontSize);
      lift = fontSize * 0.2;
      reach = fontSize * 0.75;
      centres = letters.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left - box.left + rect.width / 2,
          y: rect.top - box.top + rect.height / 2 - gsap.getProperty(el, 'y'),
        };
      });
    }

    hero.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' || !name.classList.contains('is-ready')) return;
      if (!centres.length) measure();
      const box = name.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;
      const spread = 2 * reach * reach;
      centres.forEach(({ x, y }, i) => {
        const dx = px - x;
        const dy = py - y;
        lifts[i](-lift * Math.exp(-(dx * dx + dy * dy) / spread));
      });
    }, { passive: true });

    hero.addEventListener('pointerleave', () => lifts.forEach((to) => to(0)));
    window.addEventListener('resize', () => { centres = []; });
  }

  /* ------------------------------------------------------------------ *
   * Hero portrait: tilts toward the pointer. The halo behind it and the
   * badge in front move by different amounts, which reads as depth.
   * The whole stage also drifts up a little as the hero scrolls away.
   * ------------------------------------------------------------------ */

  function initPortrait() {
    const hero = $('[data-hero]');
    const figure = hero && $('[data-tilt]', hero);
    if (!figure || !animate) return;

    gsap.to($('.hero__stage', hero), {
      yPercent: -8,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
    });

    if (!finePointer.matches) return;

    gsap.set(figure, { transformPerspective: 900 });
    const smooth = { duration: 0.8, ease: 'power3.out' };
    const turnY = gsap.quickTo(figure, 'rotationY', smooth);
    const turnX = gsap.quickTo(figure, 'rotationX', smooth);
    const shiftX = gsap.quickTo(figure, 'x', smooth);
    const halo = $('.hero__halo', hero);
    const badge = $('.hero__badge', hero);
    const haloX = halo && gsap.quickTo(halo, 'x', smooth);
    const haloY = halo && gsap.quickTo(halo, 'y', smooth);
    const badgeX = badge && gsap.quickTo(badge, 'x', smooth);
    const badgeY = badge && gsap.quickTo(badge, 'y', smooth);

    function aim(nx, ny) {
      turnY(nx * 6);
      turnX(-ny * 4);
      shiftX(nx * 10);
      haloX?.(-nx * 18);
      haloY?.(-ny * 12);
      badgeX?.(nx * 26);
      badgeY?.(ny * 18);
    }

    hero.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const rect = hero.getBoundingClientRect();
      // -1 at the left/top edge of the hero, +1 at the right/bottom.
      aim(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
    }, { passive: true });
    hero.addEventListener('pointerleave', () => aim(0, 0));
  }

  /* ------------------------------------------------------------------ *
   * Hero background: a 3D terrain of ridgelines (Three.js, js/terrain.js).
   *
   * Three.js is large, so it is fetched only now, after the page is already
   * interactive. Until it arrives the card shows its gradient background;
   * if WebGL is unavailable it simply stays that way.
   * ------------------------------------------------------------------ */

  function initTerrain() {
    const canvas = $('[data-terrain]');
    if (!canvas || !scriptUrl) return;

    // As the hero scrolls away, the terrain's camera flies forward into it.
    if (animate) {
      ScrollTrigger.create({
        trigger: '[data-hero]',
        start: 'top top',
        end: 'bottom top',
        onUpdate: (self) => { heroScroll.progress = self.progress; },
      });
    }

    // Parsing Three.js and compiling its shader is the heaviest task on the
    // page, so it waits until the browser is idle, after the hero intro,
    // rather than competing with the intro for frames.
    const start = () => import(new URL('terrain.js', scriptUrl).href)
      .then(({ mountTerrain }) => mountTerrain(canvas, { gsap, still: !animate, scroll: heroScroll }))
      .catch((error) => console.warn('Hero terrain unavailable:', error));

    const whenIdle = window.requestIdleCallback
      ? (callback) => window.requestIdleCallback(callback, { timeout: 2500 })
      : (callback) => setTimeout(callback, 1200);
    const afterLoad = () => setTimeout(() => whenIdle(start), animate ? 900 : 0);

    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
  }

  /* ------------------------------------------------------------------ *
   * Navigation: scrolled state, hide on scroll down, current section,
   * smooth in-page links, and the full-screen menu on small screens.
   * ------------------------------------------------------------------ */

  function initNav() {
    const nav = $('[data-nav]');
    if (!nav) return;

    const toggle = $('[data-nav-toggle]', nav);
    const label = $('.nav__toggle-label', nav);
    const links = $$('.nav__links a', nav);
    let lastY = window.scrollY;

    const onScroll = oncePerFrame(() => {
      const y = window.scrollY;
      nav.classList.toggle('is-scrolled', y > 8);
      // Ignore tiny movements so the bar does not flicker on trackpads.
      if (Math.abs(y - lastY) > 6) {
        nav.classList.toggle('is-hidden', y > lastY && y > 480 && !nav.classList.contains('is-open'));
        lastY = y;
      }
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    function setMenu(open) {
      nav.classList.toggle('is-open', open);
      toggle?.setAttribute('aria-expanded', String(open));
      if (label) label.textContent = open ? 'Close' : 'Menu';
      document.documentElement.style.overflow = open ? 'hidden' : '';
      if (open) lenis?.stop();
      else lenis?.start();
    }

    toggle?.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setMenu(false);
        toggle?.focus();
      }
    });
    // If the window grows past the phone layout while the sheet is open, close it.
    window.matchMedia('(min-width: 761px)').addEventListener('change', (event) => {
      if (event.matches) setMenu(false);
    });

    // In-page links scroll smoothly and move focus to the target, for keyboard users.
    // (CSS scroll-behavior is left off: it fights ScrollTrigger's measurements.)
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      const target = link && link.hash.length > 1 && document.getElementById(link.hash.slice(1));
      if (!target) return;
      event.preventDefault();
      setMenu(false);
      scrollToElement(target);
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      history.pushState(null, '', link.hash);
    });

    // A section is "current" while it crosses a thin band just above mid-screen.
    const byId = new Map(links.map((link) => [link.hash.slice(1), link]));
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const link = byId.get(entry.target.id);
        if (!link) continue;
        if (entry.isIntersecting) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    }, { rootMargin: '-40% 0px -55% 0px' });
    byId.forEach((_, id) => {
      const section = document.getElementById(id);
      if (section) spy.observe(section);
    });
  }

  /* ------------------------------------------------------------------ *
   * Scroll reveals
   * ------------------------------------------------------------------ */

  /** Blocks marked [data-reveal] fade up as they enter, in small staggered groups. */
  function initReveal() {
    const items = $$('[data-reveal]');
    if (!items.length || !animate) return;

    gsap.set(items, { autoAlpha: 0, y: 28 });
    ScrollTrigger.batch(items, {
      start: 'top 92%',
      once: true,
      onEnter: (batch) => gsap.to(batch, {
        autoAlpha: 1,
        y: 0,
        duration: 0.8,
        ease: 'power3.out',
        stagger: 0.07,
        overwrite: true,
        // Each element gets its own GPU layer only while it moves; once it has
        // landed, the inline styles go and the layer is handed back.
        force3D: true,
        clearProps: 'opacity,visibility,transform',
      }),
    });

    // A reload part-way down the page restores the scroll position; anything
    // already above the fold must not stay hidden waiting for an entrance.
    requestAnimationFrame(() => {
      const passed = items.filter((el) => el.getBoundingClientRect().bottom < 0);
      if (passed.length) gsap.set(passed, { autoAlpha: 1, y: 0 });
    });
  }

  /** Section headings rise into place one word at a time. */
  function initHeadings() {
    for (const head of $$('.section__head')) {
      const heading = $('h2', head);
      if (!heading) continue;
      const words = splitText(heading, 'word');
      if (!animate) continue;

      gsap.timeline({ scrollTrigger: { trigger: head, start: 'top 88%', once: true } })
        .from($('.section__no', head), { autoAlpha: 0, x: -12, duration: 0.6, ease: 'power3.out' }, 0)
        .from(words, { yPercent: 115, duration: 0.9, ease: 'expo.out', stagger: 0.045 }, 0);
    }
  }

  /**
   * Paragraphs marked [data-scrub-words] start faint and light up word by
   * word, tied directly to the scroll position: scrolling back dims them again.
   */
  function initWordScrub() {
    for (const block of $$('[data-scrub-words]')) {
      const words = splitText(block, 'word');
      if (!animate) continue;

      gsap.fromTo(words, { opacity: 0.16 }, {
        opacity: 1,
        ease: 'none',
        stagger: 0.1,
        scrollTrigger: { trigger: block, start: 'top 85%', end: 'bottom 45%', scrub: true },
      });
    }
  }

  /** Figures count up from zero the first time they are seen. */
  function initCounters() {
    if (!animate) return;
    for (const el of $$('[data-count]')) {
      const target = Number(el.dataset.count);
      const decimals = Number(el.dataset.decimals ?? 0);
      const pad = Number(el.dataset.pad ?? 0);
      if (!Number.isFinite(target)) continue;

      const counter = { value: 0 };
      gsap.to(counter, {
        value: target,
        duration: 1.4,
        ease: 'power2.out',
        onUpdate: () => { el.textContent = counter.value.toFixed(decimals).padStart(pad, '0'); },
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      });
    }
  }

  /** Reading progress bar along the top edge. */
  function initProgress() {
    const bar = $('[data-progress]');
    if (!bar || !hasGsap) return;
    gsap.to(bar, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: true },
    });
  }

  /* ------------------------------------------------------------------ *
   * Ticker: two rows drifting in opposite directions. Scroll speed
   * pushes them along and leans them in the direction of travel.
   * ------------------------------------------------------------------ */

  function initTicker() {
    const root = $('[data-ticker]');
    if (!root) return;

    const DRIFT = 0.05; // pixels per millisecond with no scrolling

    const rows = $$('.ticker__row', root).map((el) => ({
      el,
      group: el.firstElementChild,
      direction: el.hasAttribute('data-reverse') ? 1 : -1,
      width: 0,
      x: 0,
    }));

    // Repeat each row's content until it covers the screen, plus one spare copy to scroll into.
    function build() {
      for (const row of rows) {
        row.el.replaceChildren(row.group);
        row.width = row.group.offsetWidth;
        if (!row.width) continue;
        const copies = Math.ceil(window.innerWidth / row.width) + 1;
        for (let i = 0; i < copies; i++) row.el.append(row.group.cloneNode(true));
      }
    }

    build();
    window.addEventListener('resize', oncePerFrame(build));
    document.fonts?.ready.then(build);
    if (!animate) return;

    const place = rows.map((row) => gsap.quickSetter(row.el, 'x', 'px'));
    const lean = rows.map((row) => gsap.quickTo(row.el, 'skewX', { duration: 0.4, ease: 'power3.out' }));
    let boost = 0; // extra pixels per frame from scrolling; decays back to zero

    function tick(_time, deltaMs) {
      boost *= 0.9;
      rows.forEach((row, i) => {
        if (!row.width) return;
        row.x += row.direction * (DRIFT * deltaMs + boost);
        row.x = ((row.x % row.width) - row.width) % row.width; // wrap into (-width, 0]
        place[i](row.x);
        lean[i](clamp(boost * 0.35, -8, 8) * -row.direction);
      });
    }

    let running = false;
    const run = (on) => {
      if (on === running) return;
      running = on;
      if (on) gsap.ticker.add(tick);
      else gsap.ticker.remove(tick);
    };

    const trigger = ScrollTrigger.create({
      trigger: root,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => run(self.isActive),
      onUpdate: (self) => { boost = clamp(self.getVelocity() / 140, -30, 30); },
    });
    run(trigger.isActive);
  }

  /* ------------------------------------------------------------------ *
   * Work at iLogitron: a highlight that follows the pointer inside each
   * card, and (on tall screens, where the cards stick) the covered card
   * shrinks slightly as the next one slides over it.
   * ------------------------------------------------------------------ */

  function initJobs() {
    const list = $('.jobs__list');
    if (!list) return;
    const cards = $$('.job', list);

    if (finePointer.matches) {
      list.addEventListener('pointermove', oncePerFrame((event) => {
        const card = event.target.closest('.job');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        card.style.setProperty('--my', `${event.clientY - rect.top}px`);
      }), { passive: true });
    }

    if (!animate) return;
    gsap.matchMedia().add('(min-width: 761px) and (min-height: 820px)', () => {
      cards.slice(0, -1).forEach((card, i) => {
        gsap.to(card, {
          scale: 0.95,
          ease: 'none',
          scrollTrigger: { trigger: cards[i + 1], start: 'top bottom', end: 'top 20%', scrub: true },
        });
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Contact: the black band rises like a curtain. It starts slightly
   * narrower with deeper rounded corners and opens to full width as it
   * scrolls into view, tied directly to the scroll position.
   * ------------------------------------------------------------------ */

  function initContactCurtain() {
    const band = $('#contact');
    if (!band || !animate) return;

    gsap.fromTo(band,
      { scaleX: 0.92, borderTopLeftRadius: '120px', borderTopRightRadius: '120px' },
      {
        scaleX: 1,
        borderTopLeftRadius: '45px',
        borderTopRightRadius: '45px',
        ease: 'none',
        transformOrigin: 'center top',
        scrollTrigger: { trigger: band, start: 'top bottom', end: 'top 35%', scrub: true },
      });
  }

  /* ------------------------------------------------------------------ *
   * Buttons marked [data-magnetic] lean toward the pointer.
   * ------------------------------------------------------------------ */

  function initMagnetic() {
    if (!animate || !finePointer.matches) return;

    for (const button of $$('[data-magnetic]')) {
      const toX = gsap.quickTo(button, 'x', { duration: 0.5, ease: 'power3.out' });
      const toY = gsap.quickTo(button, 'y', { duration: 0.5, ease: 'power3.out' });

      button.addEventListener('pointermove', (event) => {
        const rect = button.getBoundingClientRect();
        toX((event.clientX - rect.left - rect.width / 2) * 0.3);
        toY((event.clientY - rect.top - rect.height / 2) * 0.4);
      }, { passive: true });
      button.addEventListener('pointerleave', () => {
        toX(0);
        toY(0);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Local time in Agartala, updated on the minute.
   * ------------------------------------------------------------------ */

  function initClock() {
    const el = $('[data-clock]');
    if (!el) return;

    const formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
    });

    (function tick() {
      const now = new Date();
      el.textContent = formatter.format(now);
      el.dateTime = now.toISOString();
      // Sleep until just after the next minute starts rather than polling every second.
      setTimeout(tick, 60_000 - (now.getTime() % 60_000) + 50);
    })();
  }

  /* ------------------------------------------------------------------ *
   * Filter chips, shared by the projects index and the experience log.
   *
   * `matches(item, value)` decides whether an item belongs to a filter.
   * Each chip gets a small count, and the active filter is mirrored into
   * the URL so a filtered view can be shared.
   * ------------------------------------------------------------------ */

  function createFilter({ root, items, matches, noun, param, onChange }) {
    const chips = $$('[data-filter]', root);
    const countLabel = $('[data-count-label]', root);
    if (!chips.length) return;

    for (const chip of chips) {
      const total = items.filter((item) => matches(item, chip.dataset.filter)).length;
      const count = document.createElement('sup');
      count.textContent = total;
      chip.append(count);
    }

    function apply(value, { animateIn = true } = {}) {
      const shown = [];
      for (const item of items) {
        const visible = matches(item, value);
        item.hidden = !visible;
        if (visible) shown.push(item);
      }
      for (const chip of chips) {
        const active = chip.dataset.filter === value;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(active));
      }
      if (countLabel) countLabel.textContent = `${shown.length} ${shown.length === 1 ? noun[0] : noun[1]}`;
      onChange?.(value);
      query.set(param, value === 'all' ? '' : value);

      if (animateIn && animate) {
        gsap.fromTo(shown, { autoAlpha: 0, y: 14 }, {
          autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out', stagger: 0.035, overwrite: true,
        });
      }
      refreshScroll();
    }

    chips.forEach((chip) => chip.addEventListener('click', () => apply(chip.dataset.filter)));

    const initial = query.get(param);
    if (initial && chips.some((chip) => chip.dataset.filter === initial)) {
      apply(initial, { animateIn: false });
    }
  }

  /* ------------------------------------------------------------------ *
   * Projects index: filtering, plus an image preview that trails the cursor.
   * ------------------------------------------------------------------ */

  function initProjects() {
    const root = $('[data-work]');
    const list = root && $('[data-work-list]', root);
    if (!list) return;
    const rows = $$('.work__row', list);

    createFilter({
      root,
      items: rows,
      matches: (row, tag) => tag === 'all' || row.dataset.tags.split(' ').includes(tag),
      noun: ['project', 'projects'],
      param: 'work',
    });

    if (animate && finePointer.matches) initProjectPreview(list, rows);
  }

  function initProjectPreview(list, rows) {
    const preview = document.createElement('div');
    preview.className = 'work-preview';
    preview.setAttribute('aria-hidden', 'true');

    // One stacked image per project, so switching rows is a cross-fade, not a reload.
    const images = new Map();
    for (const row of rows) {
      const thumb = $('.work__thumb', row);
      if (!thumb) continue;
      const image = new Image();
      image.decoding = 'async';
      image.alt = '';
      image.dataset.src = thumb.getAttribute('src');
      images.set(row, image);
      preview.append(image);
    }
    document.body.append(preview);

    const follow = { duration: 0.55, ease: 'power3.out' };
    const toX = gsap.quickTo(preview, 'x', follow);
    const toY = gsap.quickTo(preview, 'y', follow);
    const toTilt = gsap.quickTo(preview, 'rotation', { duration: 0.5, ease: 'power3.out' });
    let activeRow = null;
    let lastX = 0;

    function show(row, x, y) {
      if (row === activeRow) return;
      if (!activeRow) {
        // First appearance: start where the pointer is instead of flying in from the corner.
        toX(x, x);
        toY(y, y);
      }
      images.get(activeRow)?.classList.remove('is-active');
      activeRow = row;

      const image = images.get(row);
      if (image) {
        if (!image.src) image.src = image.dataset.src; // loaded on first hover only
        image.classList.add('is-active');
      }
      preview.classList.toggle('is-visible', Boolean(image));
    }

    function hide() {
      images.get(activeRow)?.classList.remove('is-active');
      activeRow = null;
      preview.classList.remove('is-visible');
      toTilt(0);
    }

    list.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const row = event.target.closest('.work__row');
      if (!row) return hide();

      const { offsetWidth: w, offsetHeight: h } = preview;
      const x = clamp(event.clientX + 32, 12, window.innerWidth - w - 12);
      const y = clamp(event.clientY - h / 2, 12, window.innerHeight - h - 12);
      show(row, x, y);
      toX(x);
      toY(y);
      // Lean into the direction of travel, like a card being dragged by its edge.
      toTilt(clamp((event.clientX - lastX) * 0.6, -8, 8));
      lastX = event.clientX;
    }, { passive: true });
    list.addEventListener('pointerleave', hide);
    window.addEventListener('scroll', () => { if (activeRow) hide(); }, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   * Experience log: one row open at a time, plus filtering by type.
   * ------------------------------------------------------------------ */

  function initLog() {
    const root = $('[data-log]');
    if (!root) return;
    const rows = $$('.log__row', root);

    function setOpen(row, open) {
      row.classList.toggle('is-open', open);
      $('.log__head', row)?.setAttribute('aria-expanded', String(open));
    }

    root.addEventListener('click', (event) => {
      const head = event.target.closest('.log__head');
      if (!head) return;
      const row = head.closest('.log__row');
      const willOpen = !row.classList.contains('is-open');
      rows.forEach((other) => setOpen(other, false));
      setOpen(row, willOpen);
      refreshScroll(); // the page height changed
    });

    createFilter({
      root,
      items: rows,
      matches: (row, category) => category === 'all' || row.dataset.cat === category,
      noun: ['entry', 'entries'],
      param: 'log',
      onChange: () => rows.forEach((row) => row.hidden && setOpen(row, false)),
    });
  }

  /* ------------------------------------------------------------------ *
   * Copy-to-clipboard buttons.
   * ------------------------------------------------------------------ */

  async function copyText(text, successMessage = 'Copied') {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage);
    } catch {
      toast('Could not copy. Select the text and copy it manually.');
    }
  }

  function initCopy() {
    for (const button of $$('[data-copy]')) {
      button.addEventListener('click', () => copyText(button.dataset.copy, 'Email address copied'));
    }
  }

  /* ------------------------------------------------------------------ *
   * Floating "Hire me" button: shown between the hero and the contact
   * section, where it would be redundant.
   * ------------------------------------------------------------------ */

  function initHireButton() {
    const button = $('[data-hire]');
    const hero = $('[data-hero]');
    const contact = $('#contact');
    if (!button || !hero || !contact) return;

    const visible = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      button.classList.toggle('is-on', visible.size === 0);
    });
    observer.observe(hero);
    observer.observe(contact);
  }

  /* ------------------------------------------------------------------ *
   * Command palette (Ctrl/Cmd + K, or "/").
   *
   * Commands are gathered from the page itself (sections, projects and
   * contact links), so the palette never drifts out of date with the HTML.
   * ------------------------------------------------------------------ */

  /**
   * Subsequence match: every character of `needle` must appear in `text`, in
   * order. Matches at the start of a word and runs of consecutive characters
   * score higher. Returns null when there is no match.
   */
  function fuzzyMatch(needle, text) {
    const haystack = text.toLowerCase();
    const positions = [];
    let score = 0;
    let searchFrom = 0;

    for (const char of needle.toLowerCase()) {
      if (char === ' ') continue;
      const at = haystack.indexOf(char, searchFrom);
      if (at === -1) return null;

      const startsWord = at === 0 || /[\s\-./&]/.test(haystack[at - 1]);
      const continuesRun = positions.length > 0 && at === positions[positions.length - 1] + 1;
      score += (startsWord ? 8 : 0) + (continuesRun ? 5 : 0) - Math.min(at - searchFrom, 6) * 0.5;

      positions.push(at);
      searchFrom = at + 1;
    }
    return { score: score - haystack.length * 0.02, positions };
  }

  function collectCommands() {
    const open = (url) => () => window.open(url, '_blank', 'noopener');
    const goTo = (el) => () => scrollToElement(el);
    const commands = [];

    for (const link of $$('.nav__links a')) {
      const section = $(link.hash);
      const name = link.lastChild.textContent.trim();
      if (section) commands.push({ label: `Go to ${name}`, kind: 'Section', run: goTo(section) });
    }
    for (const row of $$('.work__row')) {
      const name = $('.work__name', row)?.firstChild.textContent.trim();
      const link = $('a', row);
      if (name && link) commands.push({ label: name, kind: 'Project', run: open(link.href) });
    }
    for (const link of $$('a[data-command]')) {
      commands.push({ label: link.dataset.command, kind: 'Link', run: open(link.href) });
    }
    const email = $('[data-copy]')?.dataset.copy;
    if (email) {
      commands.push({ label: 'Copy email address', kind: 'Action', run: () => copyText(email, 'Email address copied') });
    }
    const top = $('#top');
    if (top) commands.push({ label: 'Back to top', kind: 'Section', run: goTo(top) });
    return commands;
  }

  function initPalette() {
    const dialog = $('[data-palette]');
    const input = dialog && $('[data-palette-input]', dialog);
    const list = dialog && $('[data-palette-list]', dialog);
    if (!list || typeof dialog.showModal !== 'function') return;

    const commands = collectCommands();
    let results = [];
    let selected = 0;

    for (const key of $$('[data-mod-key]')) key.textContent = isMac ? '⌘K' : 'Ctrl K';

    /** Build the label with matched characters wrapped in <mark>. */
    function highlight(label, positions) {
      const fragment = document.createDocumentFragment();
      const hits = new Set(positions);
      let run = '';
      let runIsHit = false;

      const flush = () => {
        if (!run) return;
        if (runIsHit) {
          const mark = document.createElement('mark');
          mark.textContent = run;
          fragment.append(mark);
        } else {
          fragment.append(run);
        }
        run = '';
      };

      [...label].forEach((char, index) => {
        const isHit = hits.has(index);
        if (isHit !== runIsHit) flush();
        runIsHit = isHit;
        run += char;
      });
      flush();
      return fragment;
    }

    function select(index) {
      selected = results.length ? (index + results.length) % results.length : 0;
      $$('.palette__item', list).forEach((item, i) => {
        const active = i === selected;
        item.setAttribute('aria-selected', String(active));
        if (active) {
          input.setAttribute('aria-activedescendant', item.id);
          item.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    function render() {
      const needle = input.value.trim();
      results = needle
        ? commands
            .map((command) => ({ command, match: fuzzyMatch(needle, command.label) }))
            .filter((result) => result.match)
            .sort((a, b) => b.match.score - a.match.score)
            .slice(0, 9)
        : commands.map((command) => ({ command, match: { positions: [] } }));

      list.replaceChildren();
      if (!results.length) {
        const empty = document.createElement('li');
        empty.className = 'palette__empty';
        empty.textContent = `Nothing matches "${needle}".`;
        list.append(empty);
        input.removeAttribute('aria-activedescendant');
        return;
      }

      results.forEach(({ command, match }, index) => {
        const item = document.createElement('li');
        item.className = 'palette__item';
        item.id = `palette-option-${index}`;
        item.setAttribute('role', 'option');
        item.dataset.index = index;

        const label = document.createElement('span');
        label.append(highlight(command.label, match.positions));
        const kind = document.createElement('small');
        kind.textContent = command.kind;

        item.append(label, kind);
        list.append(item);
      });
      select(0);
    }

    function run(result) {
      if (!result) return;
      dialog.close();
      result.command.run();
    }

    function openPalette() {
      if (dialog.open) return;
      input.value = '';
      render();
      dialog.showModal();
      lenis?.stop();
    }
    dialog.addEventListener('close', () => lenis?.start());

    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
      const moves = { ArrowDown: selected + 1, ArrowUp: selected - 1, Home: 0, End: results.length - 1 };
      if (event.key in moves) {
        event.preventDefault();
        select(moves[event.key]);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        run(results[selected]);
      }
    });

    list.addEventListener('pointermove', (event) => {
      const item = event.target.closest('.palette__item');
      if (item && Number(item.dataset.index) !== selected) select(Number(item.dataset.index));
    });
    list.addEventListener('click', (event) => {
      const item = event.target.closest('.palette__item');
      if (item) run(results[Number(item.dataset.index)]);
    });

    // A click that lands on the <dialog> itself (not its children) is a click on the backdrop.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    $$('[data-palette-open]').forEach((button) => button.addEventListener('click', openPalette));

    document.addEventListener('keydown', (event) => {
      const typing = /^(input|textarea|select)$/i.test(event.target.tagName) || event.target.isContentEditable;
      const shortcut = (isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !typing;
      if (!shortcut && !slash) return;
      event.preventDefault();
      if (dialog.open) dialog.close();
      else openPalette();
    });
  }

  /* ------------------------------------------------------------------ *
   * Start-up. A failure in one feature is logged and the rest carry on.
   * ------------------------------------------------------------------ */

  function run(name, feature) {
    try {
      return feature();
    } catch (error) {
      console.error(`${name} failed`, error);
      return undefined;
    }
  }

  // Smooth scrolling first, so every ScrollTrigger below is created against it.
  run('initSmoothScroll', initSmoothScroll);

  // Then the intro: it is above the fold and the first thing a visitor sees.
  // The preloader plays it when it leaves; if the preloader fails, play it now.
  const intro = run('initIntro', initIntro) ?? { letters: [], play() {} };
  run('initLetterHover', () => initLetterHover(intro.letters));
  if (!run('initLoader', () => { initLoader(intro.play); return true; })) intro.play();

  const features = {
    initHeadings, initReveal, initWordScrub, initCounters, initProgress, initNav, initClock,
    initPortrait, initTicker, initJobs, initContactCurtain, initMagnetic, initProjects, initLog,
    initCopy, initHireButton, initPalette, initTerrain, initStory, initFooterName, initCursor,
  };
  for (const [name, feature] of Object.entries(features)) run(name, feature);

  // Web fonts change text widths, and with them every trigger position.
  if (hasGsap) document.fonts?.ready.then(() => ScrollTrigger.refresh());
})();
