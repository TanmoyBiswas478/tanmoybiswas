(() => {
  'use strict';

  // Environment and helpers

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const scriptUrl = document.currentScript?.src;

  if (location.protocol === 'file:') {
    console.warn('Opened from disk (file://): browsers block the web fonts and the 3D scenes here. '
      + 'Run start-local.cmd and use http://localhost:5500 instead.');
  }

  const { gsap, ScrollTrigger } = window;
  const hasGsap = Boolean(gsap && ScrollTrigger);
  if (hasGsap) gsap.registerPlugin(ScrollTrigger);

  const animate = hasGsap && !reducedMotion.matches;

  const heroScroll = { progress: 0 };   // 0..1 as the hero scrolls away
  const storyState = { morph: 0 };      // 0..2 through the pinned story

  function scrollToElement(el) {
    el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  const heroReady = (() => {
    const portrait = document.querySelector('.hero__portrait img');
    const loaded = !portrait || portrait.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
          portrait.addEventListener('load', resolve, { once: true });
          portrait.addEventListener('error', resolve, { once: true });
        });
    const decoded = loaded.then(() => portrait?.decode?.()).catch(() => {});
    return Promise.race([
      Promise.all([document.fonts?.ready, decoded]),
      new Promise((resolve) => setTimeout(resolve, 2200)),
    ]);
  })();

  let introFinished;
  const introDone = new Promise((resolve) => { introFinished = resolve; });

  let terrainFinished;
  const terrainSettled = new Promise((resolve) => { terrainFinished = resolve; });

  const whenIdle = window.requestIdleCallback
    ? (callback) => window.requestIdleCallback(callback, { timeout: 600 })
    : (callback) => setTimeout(callback, 100);

  function cachedRect(el) {
    let rect = null;
    const reset = () => { rect = null; };
    window.addEventListener('scroll', reset, { passive: true });
    window.addEventListener('resize', reset);
    return () => (rect ??= el.getBoundingClientRect());
  }

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

  const refreshScroll = (() => {
    let timer = 0;
    return () => {
      if (!hasGsap) return;
      clearTimeout(timer);
      timer = setTimeout(() => ScrollTrigger.refresh(), 350);
    };
  })();

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

  function splitText(root, by) {
    const spans = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const node of textNodes) {
      const parts = by === 'char' ? [...node.textContent] : node.textContent.split(/(\s+)/);
      const highlighted = by === 'word' && node.parentElement.closest('em');
      const fragment = document.createDocumentFragment();

      parts.forEach((part, index) => {
        if (!part.trim()) {
          if (part && !highlighted) fragment.append(part);
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

  // Hero intro

  function initIntro() {
    const hero = $('[data-hero]');
    const name = hero && $('[data-kinetic]', hero);
    if (!name) return { letters: [], play() {} };

    name.setAttribute('aria-label', name.textContent.replace(/\s+/g, ' ').trim());
    const lines = $$('.line', name).map((line) => {
      line.setAttribute('aria-hidden', 'true');
      return splitText(line, 'char');
    });
    name.classList.add('is-split');

    const parts = $$('[data-intro]', hero);
    const finish = () => {
      name.classList.add('is-ready');
      introFinished();
    };

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

    gsap.set(parts, { opacity: 1, animation: 'none' });

    const intro = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' }, onComplete: finish })
      .from(first, { yPercent: 115, duration: 1, stagger: 0.035 }, 0)
      .fromTo(slab, { '--slab': 0 }, { '--slab': 1, duration: 0.7, ease: 'power4.inOut' }, 0.2)
      .from(last, { yPercent: 115, duration: 1, stagger: 0.035 }, 0.45)
      .from(visual, { clipPath: 'inset(100% 0% 0% 0% round 12px)', duration: 1.1, ease: 'expo.inOut', clearProps: 'clipPath' }, 0.1)
      .from(portrait, { scale: 1.18, yPercent: 6, duration: 1.4 }, 0.35)
      .from(fades, { autoAlpha: 0, y: 18, duration: 0.8, stagger: 0.1, ease: 'power3.out' }, 0.55);

    return { letters: lines.flat(), play: () => intro.play() };
  }

  // Preloader

  function initLoader(onDone) {
    const loader = $('[data-loader]');
    const skip = !loader || !animate || document.documentElement.classList.contains('no-loader');
    if (skip) {
      loader?.remove();
      heroReady.then(onDone);
      return;
    }
    try { sessionStorage.setItem('tb-visited', '1'); } catch { /* private mode */ }

    const root = document.documentElement;
    root.style.overflow = 'hidden';

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
    Promise.all([counted, heroReady]).then(() => {
      gsap.to(loader, {
        yPercent: -100,
        duration: 0.9,
        ease: 'expo.inOut',
        onComplete: () => {
          loader.remove();
          root.style.overflow = '';
        },
      });
      gsap.delayedCall(0.35, onDone);
    });
  }

  // Cursor follower

  function initCursor() {
    const cursor = $('[data-cursor]');
    if (!cursor) return;
    if (!animate || !finePointer.matches) {
      cursor.remove();
      return;
    }

    const label = $('[data-cursor-label]', cursor);
    document.documentElement.classList.add('has-custom-cursor');
    const toX = gsap.quickTo(cursor, 'x', { duration: 0.15, ease: 'power3.out' });
    const toY = gsap.quickTo(cursor, 'y', { duration: 0.15, ease: 'power3.out' });
    let visible = false;

    window.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      if (!visible) {
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

    const hideCursor = () => {
      cursor.classList.remove('is-visible');
      visible = false;
    };
    document.documentElement.addEventListener('pointerleave', hideCursor);

    for (const frame of $$('iframe')) frame.addEventListener('pointerenter', hideCursor);

    const dialogs = $$('dialog');
    if (typeof cursor.showPopover === 'function') {
      cursor.setAttribute('popover', 'manual');
      const raise = () => {
        try {
          if (cursor.matches(':popover-open')) cursor.hidePopover();
          cursor.showPopover();
        } catch {}
      };
      raise();
      new MutationObserver(raise).observe(document.body, { subtree: true, attributeFilter: ['open'] });
    } else {
      const sync = () => document.documentElement.classList
        .toggle('cursor-under-dialog', dialogs.some((d) => d.open));
      new MutationObserver(sync).observe(document.body, { subtree: true, attributeFilter: ['open'] });
    }
  }

  // Pinned story

  function initStory() {
    const section = $('[data-story]');
    if (!section) return;
    const stage = $('[data-story-stage]', section);
    const steps = $$('.story__step', section);
    const bar = $('[data-story-bar]', section);

    if (animate && stage && steps.length === 3) {
      section.classList.add('is-pinned');
      gsap.set(steps.slice(1), { autoAlpha: 0, y: 40 });

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

    const canvas = $('[data-story-canvas]', section);
    if (!canvas || !scriptUrl) return;
    let started = false;
    const mount = () => {
      if (started) return;
      started = true;
      nearby.disconnect();
      import(new URL('story.js', scriptUrl).href)
        .then(({ mountStory }) => mountStory(canvas, { gsap, state: storyState, still: !animate }))
        .catch((error) => console.warn('Story scene unavailable:', error));
    };
    const nearby = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) mount();
    }, { rootMargin: '600px 0px' });
    nearby.observe(section);
    terrainSettled.then(() => whenIdle(mount));
  }

  function initOrb() {
    const canvas = $('[data-orb]');
    if (!canvas || !scriptUrl) return;
    let started = false;
    const mount = () => {
      if (started) return;
      started = true;
      nearby.disconnect();
      import(new URL('orb.js', scriptUrl).href)
        .then(({ mountOrb }) => mountOrb(canvas, { gsap, ScrollTrigger: hasGsap ? ScrollTrigger : null, still: !animate }))
        .catch((error) => console.warn('Contact orb unavailable:', error));
    };
    const nearby = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) mount();
    }, { rootMargin: '600px 0px' });
    nearby.observe(canvas);
    terrainSettled.then(() => setTimeout(() => whenIdle(mount), 1500));
  }

  function initSkills() {
    const root = $('[data-skills]');
    if (!root || !scriptUrl) return;
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    root.classList.add('has-globe');
    let started = false;
    const mount = () => {
      if (started) return;
      started = true;
      nearby.disconnect();
      import(new URL('skills.js', scriptUrl).href)
        .then(({ mountSkills }) => mountSkills(root, { gsap, still: !animate }))
        .then((ok) => { if (!ok) root.classList.remove('has-globe'); })
        .catch((error) => { root.classList.remove('has-globe'); console.warn('Skill globe unavailable:', error); });
    };
    const nearby = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) whenIdle(mount);
    }, { rootMargin: '700px 0px' });
    terrainSettled.then(() => nearby.observe(root));
  }

  function initImages() {
    const lazy = $$('img[loading="lazy"]');
    if (!lazy.length) return;
    const decodeNext = (queue) => {
      const img = queue.shift();
      if (!img) return;
      img.decode?.().catch(() => {}).finally(() => whenIdle(() => decodeNext(queue)));
    };
    const fetchAll = () => whenIdle(() => {
      lazy.forEach((img) => { img.loading = 'eager'; });
      decodeNext([...lazy]);
    });
    if (document.readyState === 'complete') fetchAll();
    else window.addEventListener('load', fetchAll, { once: true });
  }

  function initGithub() {
    const section = $('[data-github]');
    if (!section || !scriptUrl) return;
    let started = false;
    const mount = () => {
      if (started) return;
      started = true;
      nearby.disconnect();
      import(new URL('github.js', scriptUrl).href)
        .then(({ mountContributions }) => mountContributions(section, {
          gsap, ScrollTrigger: hasGsap ? ScrollTrigger : null, still: !animate,
        }))
        .catch((error) => console.warn('GitHub contributions unavailable:', error))
        .finally(refreshScroll);
    };
    const nearby = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) mount();
    }, { rootMargin: '700px 0px' });
    nearby.observe(section);
    terrainSettled.then(() => setTimeout(() => whenIdle(mount), 3000));
  }

  function initScenes() {
    const phone = window.matchMedia('(max-width: 760px)').matches;
    const canvases = $$('[data-scene]').filter((canvas) => !phone || canvas.dataset.scene === 'galaxy');
    if (!canvases.length || !scriptUrl) return;
    let queue = Promise.resolve();
    const nearby = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        nearby.unobserve(entry.target);
        const canvas = entry.target;
        queue = queue
          .then(() => new Promise((resolve) => whenIdle(resolve)))
          .then(() => import(new URL('scenes.js', scriptUrl).href))
          .then(({ mountScene }) => mountScene(canvas, {
            kind: canvas.dataset.scene, gsap, ScrollTrigger: hasGsap ? ScrollTrigger : null, still: !animate,
          }))
          .catch((error) => console.warn('Scene unavailable:', error));
      }
    }, { rootMargin: '900px 0px' });
    terrainSettled.then(() => canvases.forEach((canvas) => nearby.observe(canvas)));
  }

  // Footer

  function initFooterName() {
    const name = $('[data-footer-name]');
    if (!name) return;
    const letters = splitText(name, 'char');

    const styles = getComputedStyle(document.documentElement);
    const hex = (name, fallback) => (styles.getPropertyValue(name).trim() || fallback).replace('#', '');
    const rgb = (value) => [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
    const [from, to] = [rgb(hex('--lime', '#8b7bff')), rgb(hex('--coral', '#ff6b8b'))];
    letters.forEach((letter, i) => {
      const t = letters.length > 1 ? i / (letters.length - 1) : 0;
      letter.style.color = `rgb(${from.map((c, k) => Math.round(c + (to[k] - c) * t)).join(',')})`;
    });

    if (!animate) return;

    gsap.from(letters, {
      yPercent: 110,
      ease: 'none',
      stagger: 0.05,
      scrollTrigger: { trigger: name, start: 'top bottom', end: 'bottom bottom', scrub: 0.6 },
    });
  }

  // Hero name

  function initLetterHover(letters) {
    const name = $('[data-kinetic]');
    const hero = name?.closest('[data-hero]');
    if (!hero || !letters.length || !animate || !finePointer.matches) return;

    const lifts = letters.map((el) => gsap.quickTo(el, 'y', { duration: 0.55, ease: 'power3.out' }));
    let centres = [];
    let lift = 0;
    let reach = 1;
    const nameRect = cachedRect(name);

    function measure() {
      const box = nameRect();
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
      const box = nameRect();
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

  // Hero portrait

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

    const heroRect = cachedRect(hero);
    hero.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const rect = heroRect();
      aim(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
    }, { passive: true });
    hero.addEventListener('pointerleave', () => aim(0, 0));
  }

  // Hero background

  function initTerrain() {
    const canvas = $('[data-terrain]');
    if (!canvas || !scriptUrl) {
      terrainFinished();
      return;
    }

    if (animate) {
      ScrollTrigger.create({
        trigger: '[data-hero]',
        start: 'top top',
        end: 'bottom top',
        onUpdate: (self) => { heroScroll.progress = self.progress; },
      });
    }

    const start = () => import(new URL('terrain.js', scriptUrl).href)
      .then(({ mountTerrain }) => mountTerrain(canvas, { gsap, still: !animate, scroll: heroScroll }))
      .catch((error) => console.warn('Hero terrain unavailable:', error));

    heroReady.then(() => {
      for (const file of ['terrain.js', 'vendor/three.module.min.js']) {
        const link = document.createElement('link');
        link.rel = 'modulepreload';
        link.href = new URL(file, scriptUrl).href;
        document.head.append(link);
      }
    });

    const loaded = document.readyState === 'complete'
      ? Promise.resolve()
      : new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
    Promise.race([introDone, new Promise((resolve) => setTimeout(resolve, 6000))])
      .then(() => loaded)
      .then(() => whenIdle(() => start().finally(terrainFinished)));
  }

  // Navigation

  function initNav() {
    const nav = $('[data-nav]');
    if (!nav) return;

    const toggle = $('[data-nav-toggle]', nav);
    const label = $('.nav__toggle-label', nav);
    const links = $$('.nav__links a', nav);
    let currentY = window.scrollY;
    let lastY = currentY;

    const update = oncePerFrame(() => {
      const y = currentY;
      nav.classList.toggle('is-scrolled', y > 8);
      if (Math.abs(y - lastY) > 6) {
        nav.classList.toggle('is-hidden', y > lastY && y > 480 && !nav.classList.contains('is-open'));
        lastY = y;
      }
    });
    const onScroll = () => { currentY = window.scrollY; update(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    function setMenu(open) {
      nav.classList.toggle('is-open', open);
      toggle?.setAttribute('aria-expanded', String(open));
      if (label) label.textContent = open ? 'Close' : 'Menu';
      document.documentElement.style.overflow = open ? 'hidden' : '';
    }

    toggle?.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setMenu(false);
        toggle?.focus();
      }
    });
    window.matchMedia('(min-width: 761px)').addEventListener('change', (event) => {
      if (event.matches) setMenu(false);
    });

    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      const target = link && link.hash.length > 1 && document.getElementById(link.hash.slice(1));
      if (!target) return;
      event.preventDefault();
      setMenu(false);
      scrollToElement(target);
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      if (link.hash === '#top') history.replaceState(null, '', location.pathname + location.search);
      else history.pushState(null, '', link.hash);
    });

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

  // Scroll reveals

  function onFirstView(elements, callback, rootMargin = '0px 0px -8% 0px') {
    const observer = new IntersectionObserver((entries) => {
      const ready = entries
        .filter((entry) => entry.isIntersecting || entry.boundingClientRect.bottom < 0)
        .map((entry) => entry.target);
      if (!ready.length) return;
      ready.forEach((el) => observer.unobserve(el));
      callback(ready);
    }, { rootMargin });
    elements.forEach((el) => observer.observe(el));
  }

  function initReveal() {
    const items = $$('[data-reveal]');
    if (!items.length || !animate) return;

    gsap.set(items, { autoAlpha: 0, y: 28 });
    onFirstView(items, (batch) => gsap.to(batch, {
      autoAlpha: 1,
      y: 0,
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.07,
      overwrite: true,
      clearProps: 'opacity,visibility,transform',
    }));
  }

  function initHeadings() {
    for (const head of $$('.section__head')) {
      const heading = $('h2', head);
      if (!heading) continue;
      const words = splitText(heading, 'word');
      if (!animate) continue;

      const no = $('.section__no', head);
      const intro = gsap.timeline({ paused: true })
        .from(no, { autoAlpha: 0, x: -12, duration: 0.6, ease: 'power3.out' }, 0)
        .from(words, { yPercent: 115, duration: 0.9, ease: 'expo.out', stagger: 0.045 }, 0);
      onFirstView([head], () => intro.play());
    }
  }

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

  function initCounters() {
    if (!animate) return;
    for (const el of $$('[data-count]')) {
      const target = Number(el.dataset.count);
      const decimals = Number(el.dataset.decimals ?? 0);
      const pad = Number(el.dataset.pad ?? 0);
      if (!Number.isFinite(target)) continue;

      const counter = { value: 0 };
      const show = () => { el.textContent = counter.value.toFixed(decimals).padStart(pad, '0'); };
      const count = gsap.to(counter, { value: target, duration: 1.4, ease: 'power2.out', paused: true, onUpdate: show });
      show();
      onFirstView([el], () => count.play());
    }
  }

  function initProgress() {
    const bar = $('[data-progress]');
    if (!bar || !hasGsap) return;
    gsap.to(bar, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: true },
    });
  }

  function initToTop() {
    const button = $('[data-totop]');
    if (!button) return;

    let max = 1;
    const measure = () => { max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); };
    measure();
    window.addEventListener('resize', measure);
    new ResizeObserver(measure).observe(document.body);

    let y = window.scrollY;
    let shown = null;
    const update = oncePerFrame(() => {
      const p = clamp(y / max, 0, 1);
      button.style.setProperty('--p', p.toFixed(4));
      const on = p >= 0.5;
      if (on !== shown) {
        button.classList.toggle('is-on', on);
        shown = on;
      }
    });
    window.addEventListener('scroll', () => { y = window.scrollY; update(); }, { passive: true });
    update();
  }

  // Ticker

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

  // Work at iLogitron

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

  // Contact

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
      setTimeout(tick, 60_000 - (now.getTime() % 60_000) + 50);
    })();
  }

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

  // Projects index

  function initProjects() {
    const root = $('[data-work]');
    const list = root && $('[data-work-list]', root);
    if (!list) return;
    const rows = $$('.work__row', list);

    const stripe = () => {
      let i = 0;
      for (const row of rows) {
        if (row.hidden) continue;
        row.classList.toggle('is-dark', i % 2 === 1);
        i += 1;
      }
    };

    createFilter({
      root,
      items: rows,
      matches: (row, tag) => tag === 'all' || row.dataset.tags.split(' ').includes(tag),
      noun: ['project', 'projects'],
      param: 'work',
      onChange: stripe,
    });
    stripe();

    if (animate && finePointer.matches) initProjectPreview(list, rows);
  }

  function initProjectPreview(list, rows) {
    const preview = document.createElement('div');
    preview.className = 'work-preview';
    preview.setAttribute('aria-hidden', 'true');

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

    const preload = () => {
      for (const image of images.values()) {
        if (image.src) continue;
        image.fetchPriority = 'high';
        image.src = image.dataset.src;
        image.decode?.().catch(() => {});
      }
    };
    const nearby = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      nearby.disconnect();
      preload();
    }, { rootMargin: '1200px 0px' });
    nearby.observe(list);

    const follow = { duration: 0.55, ease: 'power3.out' };
    const toX = gsap.quickTo(preview, 'x', follow);
    const toY = gsap.quickTo(preview, 'y', follow);
    const toTilt = gsap.quickTo(preview, 'rotation', { duration: 0.5, ease: 'power3.out' });
    let activeRow = null;
    let lastX = 0;

    function show(row, x, y) {
      if (row === activeRow) return;
      if (!activeRow) {
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
      toTilt(clamp((event.clientX - lastX) * 0.6, -8, 8));
      lastX = event.clientX;
    }, { passive: true });
    list.addEventListener('pointerleave', hide);
    window.addEventListener('scroll', () => { if (activeRow) hide(); }, { passive: true });
  }

  // Experience log

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

  // Copy-to-clipboard buttons

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

  // Floating "Hire me" button

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

  let openResume = null;

  function initResume() {
    const trigger = $('[data-resume]');
    const dialog = $('[data-resume-dialog]');
    const pdf = trigger?.getAttribute('href');
    if (!pdf) return;

    let exists = null;
    let known = false;
    const check = () => (exists ??= fetch(pdf, { method: 'HEAD' })
      .then((response) => response.ok && !/html/.test(response.headers.get('content-type') || ''))
      .catch(() => false)
      .then((ok) => { known = ok; return ok; }));
    const missing = async () => {
      if (await check()) return false;
      toast('Résumé PDF not uploaded yet');
      return true;
    };

    for (const link of $$('[data-resume-download]')) {
      const label = $('[data-label]', link);
      const original = label?.textContent;
      let timer = 0;
      link.addEventListener('click', async (event) => {
        if (!known) {
          event.preventDefault();
          if (await missing()) return;
          link.click();
          return;
        }
        clearTimeout(timer);
        link.classList.remove('is-saved');
        link.classList.add('is-saving');
        timer = setTimeout(() => {
          link.classList.replace('is-saving', 'is-saved');
          if (label) label.textContent = 'Saved';
          timer = setTimeout(() => {
            link.classList.remove('is-saved');
            if (label) label.textContent = original;
          }, 1800);
        }, 550);
      });
    }

    if (!dialog) return;
    const inline = () => navigator.pdfViewerEnabled !== false && window.matchMedia('(min-width: 761px)').matches;

    const sheet = $('[data-resume-sheet]', dialog);
    const shade = $('.resume__shade', dialog);
    const fades = $$('[data-resume-fade]', dialog);
    const frame = $('[data-resume-frame]', dialog);
    frame.addEventListener('load', () => frame.classList.add('is-loaded'));
    let origin = null;
    let busy = false;

    function clipTo(el) {
      const box = sheet.getBoundingClientRect();
      const b = el?.getBoundingClientRect();
      const onScreen = b && b.width > 0 && b.bottom > 0 && b.top < innerHeight;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const t = onScreen ? b : { top: cy - 24, bottom: cy + 24, left: cx - 90, right: cx + 90, height: 48 };
      return `inset(${t.top - box.top}px ${box.right - t.right}px ${box.bottom - t.bottom}px ${t.left - box.left}px round ${t.height / 2}px)`;
    }

    async function open(from) {
      if (busy || dialog.open) return;
      if (await missing()) return;
      if (!inline()) {
        window.open(pdf, '_blank', 'noopener');
        return;
      }
      busy = true;
      origin = from;
      if (!frame.getAttribute('src')) frame.src = `${pdf}#view=FitH&navpanes=0`;
      dialog.showModal();
      if (!animate) { busy = false; return; }
      gsap.timeline({ onComplete: () => { busy = false; } })
        .fromTo(shade, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0)
        .fromTo(sheet, { clipPath: clipTo(origin), boxShadow: '0px 0px 0px #ff6b8b' }, {
          clipPath: 'inset(0px 0px 0px 0px round 12px)', boxShadow: '8px 8px 0px #ff6b8b',
          duration: 0.75, ease: 'expo.inOut', clearProps: 'clipPath,boxShadow',
        }, 0)
        .fromTo(fades, { opacity: 0, y: 14 }, {
          opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power3.out', clearProps: 'opacity,transform',
        }, 0.45);
    }

    function close() {
      if (busy || !dialog.open) return;
      const done = () => {
        dialog.close();
        gsap?.set([shade, sheet, ...fades], { clearProps: 'opacity,transform,clipPath,boxShadow' });
        busy = false;
        origin?.focus({ preventScroll: true });
      };
      if (!animate) { done(); return; }
      busy = true;
      gsap.timeline({ onComplete: done })
        .to(fades, { opacity: 0, duration: 0.2, ease: 'power1.in' }, 0)
        .fromTo(sheet, { clipPath: 'inset(0px 0px 0px 0px round 12px)', boxShadow: '8px 8px 0px #ff6b8b' },
          { clipPath: clipTo(origin), boxShadow: '0px 0px 0px #ff6b8b', duration: 0.6, ease: 'expo.inOut' }, 0.1)
        .to(shade, { opacity: 0, duration: 0.4, ease: 'power2.in' }, 0.3);
    }

    trigger.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      open(trigger);
    });
    $$('[data-resume-close]', dialog).forEach((el) => el.addEventListener('click', close));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });   // Esc
    openResume = () => open(null);
  }

  // Command palette (Ctrl/Cmd + K, or "/")

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
    if (openResume) commands.push({ label: 'View résumé', kind: 'Action', run: () => openResume() });
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
      document.documentElement.classList.add('is-palette-open');
    }
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('is-palette-open');
    });

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

  function run(name, feature) {
    try {
      return feature();
    } catch (error) {
      console.error(`${name} failed`, error);
      return undefined;
    }
  }

  const intro = run('initIntro', initIntro) ?? { letters: [], play() {} };
  run('initLetterHover', () => initLetterHover(intro.letters));
  if (!run('initLoader', () => { initLoader(intro.play); return true; })) intro.play();

  const features = {
    initHeadings, initReveal, initWordScrub, initCounters, initProgress, initNav, initClock,
    initPortrait, initTicker, initJobs, initContactCurtain, initMagnetic, initProjects, initLog,
    initCopy, initHireButton, initToTop, initResume, initPalette, initImages, initTerrain, initStory, initOrb, initSkills, initGithub, initScenes, initFooterName, initCursor,
  };
  for (const [name, feature] of Object.entries(features)) run(name, feature);

  if (hasGsap) {
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
    }
  }
})();
