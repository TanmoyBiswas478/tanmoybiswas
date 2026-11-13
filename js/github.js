/*
 * GitHub contributions as a 3D "commit city": the last twelve months as a
 * 53 x 7 grid of bars, one per day, as tall as that day's contributions.
 * Empty days are flat tiles; busy days rise from violet into coral.
 *
 * The bars grow week by week when the card scrolls into view, the city leans
 * toward the pointer (or the phone's tilt, see lean.js), and hovering or
 * tapping a bar shows its date and count.
 *
 * Data: /api/github (Vercel function, GitHub's GraphQL API, needs a
 * GITHUB_TOKEN) first, then a public mirror of the same calendar, so the
 * section also works on a plain static server.
 *
 * script.js loads this module on demand, as the section comes near.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, BoxGeometry, InstancedMesh, Mesh,
  MeshLambertMaterial, AmbientLight, DirectionalLight, Color, Group, Object3D,
  Raycaster, Vector2,
} from './vendor/three.module.min.js';
import { createLean } from './lean.js';

const $ = (selector, root = document) => root.querySelector(selector);

/* ------------------------------ Data ------------------------------ */

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

/** Resolves to { total, days: [{ date: 'YYYY-MM-DD', count, level 0..4 }] }, oldest first. */
export async function loadContributions(user) {
  // The function only exists on Vercel; locally it would just log a 404.
  const local = location.hostname === 'localhost' || location.hostname.startsWith('127.') || location.hostname === '[::1]';
  if (!local) try {
    const own = await getJson('/api/github');
    if (own?.days?.length) return own;
  } catch { /* Not deployed, no token, or rate-limited: use the public mirror. */ }

  const data = await getJson(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(user)}?y=last`);
  const days = (data.contributions ?? []).map(({ date, count, level }) => ({ date, count, level }));
  if (!days.length) throw new Error('No contribution data');
  return { total: data.total?.lastYear ?? days.reduce((sum, day) => sum + day.count, 0), days };
}

function summarise(days) {
  let longest = 0;
  let run = 0;
  let best = days[0];
  for (const day of days) {
    run = day.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (day.count > best.count) best = day;
  }
  // Today without a commit yet does not break the current streak.
  let current = 0;
  let i = days.length - 1;
  if (days[i]?.count === 0) i--;
  for (; i >= 0 && days[i].count > 0; i--) current++;
  return { longest, current, best, days: days.length, active: days.filter((day) => day.count > 0).length };
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatDate = (iso) => dateFormat.format(new Date(`${iso}T00:00:00Z`));
const plural = (n, word) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;

function fillStats(root, total, stats) {
  const set = (key, text, note) => {
    const el = $(`[data-gh-stat="${key}"]`, root);
    if (!el) return;
    el.textContent = text;
    if (note) {
      const small = document.createElement('small');
      small.textContent = note;
      el.append(small);
    }
  };
  set('total', total.toLocaleString('en-GB'));
  set('active', String(stats.active), `of the last ${stats.days} days`);
  set('longest', plural(stats.longest, 'day'), stats.current ? `current streak: ${plural(stats.current, 'day')}` : 'current streak: none');
  set('best', String(stats.best.count), `on ${formatDate(stats.best.date)}`);
}

/* ------------------------------ Scene ------------------------------ */

const SPACING = 1;          // distance between neighbouring days
const FOOTPRINT = 0.78;     // width of one bar
const MAX_HEIGHT = 4.6;     // the busiest day
const FLAT = 0.08;          // an empty day

function buildCity(days, colors) {
  // GitHub's calendar: columns are weeks, rows run Sunday (top) to Saturday.
  const offset = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const weeks = Math.ceil((offset + days.length) / 7);
  const max = Math.max(1, ...days.map((day) => day.count));

  const bars = days.map((day, i) => {
    const slot = offset + i;
    const week = Math.floor(slot / 7);
    const weekday = slot % 7;
    return {
      ...day,
      week,
      x: (week - (weeks - 1) / 2) * SPACING,
      z: (weekday - 3) * SPACING,
      // Square root keeps a few huge days from flattening everything else.
      height: day.count ? 0.35 + (MAX_HEIGHT - 0.35) * Math.sqrt(day.count / max) : FLAT,
      color: colors[Math.max(0, Math.min(4, day.level ?? 0))],
    };
  });
  return { bars, weeks };
}

export async function mountContributions(root, { gsap, ScrollTrigger, still = false } = {}) {
  const canvas = $('[data-gh-canvas]', root);
  const card = canvas?.parentElement;
  const status = $('[data-gh-status]', root);
  const tip = $('[data-gh-tip]', root);
  const user = root.dataset.github;

  let data;
  try {
    data = await loadContributions(user);
  } catch (error) {
    if (status) status.textContent = 'Could not load contributions right now. They are on GitHub.';
    throw error;
  }
  fillStats(root, data.total, summarise(data.days));
  if (!canvas) return false;

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  } catch {
    if (status) status.textContent = `${plural(data.total, 'contribution')} in the last year.`;
    return false;
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
  renderer.setPixelRatio(pixelRatio);

  const styles = getComputedStyle(document.documentElement);
  const violet = new Color(styles.getPropertyValue('--lime').trim() || '#8b7bff');
  const coral = new Color(styles.getPropertyValue('--coral').trim() || '#ff6b8b');
  const empty = new Color(styles.getPropertyValue('--olive').trim() || '#2b2550');
  const colors = [empty, violet, violet.clone().lerp(coral, 1 / 3), violet.clone().lerp(coral, 2 / 3), coral];
  const highlight = new Color('#ffffff');

  const { bars, weeks } = buildCity(data.days, colors);

  const geometry = new BoxGeometry(FOOTPRINT, 1, FOOTPRINT);
  geometry.translate(0, 0.5, 0);           // bars grow up from the ground
  const material = new MeshLambertMaterial({ color: 0xffffff, emissive: 0x0d0a24 });
  const mesh = new InstancedMesh(geometry, material, bars.length);
  bars.forEach((bar, i) => mesh.setColorAt(i, bar.color));

  // A dark plinth under the city.
  const plinth = new Mesh(
    new BoxGeometry(weeks * SPACING + 1.2, 0.3, 7 * SPACING + 1.2),
    new MeshLambertMaterial({ color: 0x17113a }),
  );
  plinth.position.y = -0.15;

  const city = new Group();
  city.add(plinth, mesh);
  const scene = new Scene();
  scene.add(city, new AmbientLight(0xffffff, 1.1));
  const sun = new DirectionalLight(0xffffff, 2.6);
  sun.position.set(-8, 14, 10);
  scene.add(sun);
  const rim = new DirectionalLight(coral, 0.9);
  rim.position.set(12, 4, -10);
  scene.add(rim);

  const camera = new PerspectiveCamera(30, 2, 0.5, 400);
  const view = { turn: -0.16, elevation: 0.62 };  // base angle of the city, radians

  /* Growth: 0..1, each week rising a little after the one before. */
  const state = { grow: still ? 1 : 0 };
  const dummy = new Object3D();
  let hovered = -1;
  let ticking = false;      // true while the animation loop runs
  let markDirty = () => {};

  function placeBars() {
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const t = Math.min(1, Math.max(0, (state.grow - (bar.week / weeks) * 0.45) / 0.55));
      const eased = 1 - (1 - t) ** 3;
      dummy.position.set(bar.x, 0, bar.z);
      dummy.scale.set(1, Math.max(0.001, bar.height * eased), 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  function frame() {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    const aspect = width / height;
    // Narrow cards turn the city further onto its diagonal, so it fits taller.
    // Narrow cards: the year runs diagonally away from the camera, so it fills the card.
    view.turn = aspect < 1.1 ? -1.2 : aspect < 1.6 ? -0.6 : -0.16;
    view.elevation = aspect < 1.1 ? 1.0 : 0.62;
    const halfWidth = (weeks * SPACING / 2) * Math.cos(view.turn) + (3.5 * SPACING) * Math.abs(Math.sin(view.turn));
    const halfFov = (camera.fov * Math.PI) / 360;
    const distance = (halfWidth * (aspect < 1.1 ? 1.9 : 1.15)) / (Math.tan(halfFov) * aspect) + 6;
    camera.aspect = aspect;
    // On phones the recent (busy) end points at the camera; aim nearer it so it is not cut off.
    const aimZ = aspect < 1.1 ? 5.5 : 0;
    camera.position.set(0, 0.6 + Math.sin(view.elevation) * distance, aimZ + Math.cos(view.elevation) * distance);
    camera.lookAt(0, 0.6, aimZ);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  const render = () => renderer.render(scene, camera);

  new ResizeObserver(() => { frame(); render(); markDirty(); }).observe(canvas);
  frame();
  // Compile shaders off the main thread (KHR_parallel_shader_compile)
  // instead of freezing the page for the first frame.
  await renderer.compileAsync(scene, camera).catch(() => {});
  city.rotation.y = view.turn;
  placeBars();
  render();
  canvas.classList.add('is-live');
  if (status) status.hidden = true;

  /* ---- Hover / tap: date and count of the bar under the pointer ---- */

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let tipTimer = 0;

  function setHovered(index) {
    if (index === hovered) return;
    if (hovered >= 0) mesh.setColorAt(hovered, bars[hovered].color);
    hovered = index;
    if (hovered >= 0) mesh.setColorAt(hovered, bars[hovered].color.clone().lerp(highlight, 0.55));
    mesh.instanceColor.needsUpdate = true;
    if (still || !ticking) render(); else markDirty();
  }

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    const index = hit?.instanceId ?? -1;
    setHovered(index);
    if (!tip) return;
    if (index < 0) {
      tip.hidden = true;
      return;
    }
    const bar = bars[index];
    tip.textContent = `${bar.count ? plural(bar.count, 'contribution') : 'No contributions'} · ${formatDate(bar.date)}`;
    tip.hidden = false;
    const x = Math.min(rect.width - 12, Math.max(12, clientX - rect.left));
    tip.style.left = `${x}px`;
    tip.style.top = `${clientY - rect.top}px`;
    // Keep the label inside the card near its edges.
    const shift = x < 120 ? '0%' : x > rect.width - 120 ? '-100%' : '-50%';
    tip.style.translate = `${shift} calc(-100% - 14px)`;
  }

  const clear = () => { setHovered(-1); if (tip) tip.hidden = true; };
  let queued = null;
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    if (!queued) requestAnimationFrame(() => { pick(queued.x, queued.y); queued = null; });
    queued = { x: event.clientX, y: event.clientY };
  }, { passive: true });
  canvas.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') clear(); });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    pick(event.clientX, event.clientY);
    clearTimeout(tipTimer);
    tipTimer = setTimeout(clear, 2600);
  }, { passive: true });

  if (still || !gsap) return true;

  /* ---- Motion: grow on first view, lean toward the pointer, drift ---- */

  const grow = () => gsap.to(state, { grow: 1, duration: 2.4, ease: 'power2.out', onUpdate: () => { placeBars(); dirty = true; } });
  if (ScrollTrigger) ScrollTrigger.create({ trigger: card, start: 'top 80%', once: true, onEnter: grow });
  else grow();

  const read = createLean(card);
  let dirty = true;
  markDirty = () => { dirty = true; };
  const lean = { x: 0, y: 0 };
  const tick = (time) => {
    const target = read(time);
    const dx = target.x - lean.x;
    const dy = target.y - lean.y;
    // Settled and not growing: skip the frame entirely (this was the lag).
    if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002 && !dirty) return;
    dirty = false;
    lean.x += dx * 0.08;
    lean.y += dy * 0.08;
    city.rotation.y = view.turn + lean.x * 0.12;
    city.rotation.x = lean.y * 0.04;
    render();
  };

  // Animate only while on screen and the tab is visible.
  let onScreen = false;
  const updateLoop = () => {
    const on = onScreen && !document.hidden;
    if (on === ticking) return;
    ticking = on;
    if (on) gsap.ticker.add(tick);
    else gsap.ticker.remove(tick);
  };
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    updateLoop();
  }).observe(canvas);
  document.addEventListener('visibilitychange', updateLoop);

  return true;
}
