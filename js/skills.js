import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points, LineSegments,
  ShaderMaterial, Group, Vector3, Color, AdditiveBlending,
} from './vendor/three.module.min.js';

const TAU = Math.PI * 2;
const R = 1.6;                                   // globe radius
const PALETTE = ['#8b7bff', '#a873f2', '#c76bd9', '#e56bb8', '#ff6b8b', '#ff8a70'];

function fibonacci(count, index) {
  const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const a = index * 2.399963;
  return new Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
}

const pointsVertex = /* glsl */ `
  uniform float uTime;
  uniform float uActive;    // highlighted group, -1 = none
  uniform float uHover;     // highlighted tool, -1 = none
  uniform float uScale;
  attribute float aGroup;   // -1 = globe surface dust
  attribute float aSkill;   // -1 = globe surface dust
  attribute float aSize;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float back = clamp((-mv.z - 4.0) / 3.2, 0.0, 1.0);      // 0 = front, 1 = back of the globe
    float node = step(-0.5, aSkill);
    float on = uActive < -0.5 ? 1.0 : 1.0 - step(0.5, abs(aGroup - uActive));
    float hot = 1.0 - step(0.5, abs(aSkill - uHover));
    float twinkle = 0.65 + 0.35 * sin(uTime * 1.3 + position.x * 9.0 + position.y * 7.0);
    float size = node > 0.5
      ? aSize * (0.6 + 0.4 * on + 0.9 * hot) * (1.0 + 0.08 * sin(uTime * 2.0 + aSkill))
      : aSize * twinkle;
    gl_PointSize = size * uScale / -mv.z;
    vColor = color;
    vAlpha = node > 0.5
      ? (mix(0.16, 1.0, on) + hot * 0.4) * (1.0 - 0.6 * back)
      : 0.5 * twinkle * (1.0 - 0.72 * back);
  }
`;
const pointsFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.16, 0.0, d);
    gl_FragColor = vec4(vColor + core * 0.7, glow * glow * vAlpha);
  }
`;
const linesVertex = /* glsl */ `
  uniform float uActive;
  attribute float aGroup;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float back = clamp((-mv.z - 4.0) / 3.2, 0.0, 1.0);
    float on = uActive < -0.5 ? 0.5 : (1.0 - step(0.5, abs(aGroup - uActive))) * 0.95 + 0.06;
    if (aGroup < -1.5) on = 0.16;                     // the globe's grid
    vColor = color;
    vAlpha = on * (1.0 - 0.75 * back);
  }
`;
const linesFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(vColor, vAlpha); }
`;

export async function mountSkills(root, { gsap, still = false } = {}) {
  const canvas = root.querySelector('[data-skills-canvas]');
  const layer = root.querySelector('[data-skills-labels]');
  const stage = canvas?.parentElement;
  const groupEls = [...root.querySelectorAll('.toolbox__grid > div')];
  if (!canvas || !layer || !groupEls.length) return false;

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
    renderer.debug.checkShaderErrors = false;    // no blocking shader-status queries
  } catch {
    return false;
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);

  const groups = groupEls.map((el, g) => ({
    el, color: PALETTE[g % PALETTE.length],
    name: el.querySelector('dt')?.textContent.trim() ?? '',
    chips: [...el.querySelectorAll('dd')],
  }));
  const skills = [];
  groups.forEach((group, g) => {
    group.el.style.setProperty('--g', group.color);
    const around = (g / groups.length) * TAU, lat = g % 2 ? 0.38 : -0.3;
    const centre = new Vector3(Math.cos(lat) * Math.sin(around), Math.sin(lat), Math.cos(lat) * Math.cos(around));
    const helper = Math.abs(centre.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const u = new Vector3().crossVectors(centre, helper).normalize();
    const v = new Vector3().crossVectors(centre, u);
    const n = group.chips.length;
    const spread = 0.3 + 0.1 * Math.sqrt(n);
    group.centre = centre.clone().multiplyScalar(R);
    group.chips.forEach((chip, j) => {
      const a = j * 2.399963 + g;
      const r = spread * Math.sqrt((j + 0.5) / n);
      const dir = centre.clone()
        .addScaledVector(u, Math.cos(a) * r)
        .addScaledVector(v, Math.sin(a) * r)
        .normalize();
      const skill = { index: skills.length, group: g, chip, name: chip.textContent.trim(), pos: dir.multiplyScalar(R) };
      chip.dataset.skill = skill.index;
      skills.push(skill);
    });
  });

  const DUST = 1400;
  const total = DUST + skills.length;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const aGroup = new Float32Array(total);
  const aSkill = new Float32Array(total);
  const aSize = new Float32Array(total);
  const violet = new Color(PALETTE[0]);
  const coral = new Color(PALETTE[4]);
  const tint = new Color();
  for (let i = 0; i < DUST; i++) {
    const p = fibonacci(DUST, i).multiplyScalar(R * (0.985 + Math.random() * 0.03));
    positions.set([p.x, p.y, p.z], i * 3);
    tint.copy(violet).lerp(coral, (p.y / R + 1) / 2);
    colors.set([tint.r, tint.g, tint.b], i * 3);
    aGroup[i] = -1; aSkill[i] = -1; aSize[i] = 10 + Math.random() * 7;
  }
  skills.forEach((skill, k) => {
    const i = DUST + k;
    positions.set([skill.pos.x, skill.pos.y, skill.pos.z], i * 3);
    tint.set(groups[skill.group].color);
    colors.set([tint.r, tint.g, tint.b], i * 3);
    aGroup[i] = skill.group; aSkill[i] = k; aSize[i] = 46;
  });
  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute('position', new BufferAttribute(positions, 3));
  pointGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  pointGeometry.setAttribute('aGroup', new BufferAttribute(aGroup, 1));
  pointGeometry.setAttribute('aSkill', new BufferAttribute(aSkill, 1));
  pointGeometry.setAttribute('aSize', new BufferAttribute(aSize, 1));

  const uniforms = {
    uTime: { value: 0 }, uActive: { value: -1 }, uHover: { value: -1 }, uScale: { value: pixelRatio * 1.6 },
  };
  const pointMaterial = new ShaderMaterial({
    uniforms, vertexShader: pointsVertex, fragmentShader: pointsFragment,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });

  const line = [], lineColor = [], lineGroup = [];
  const seen = new Set();
  const arc = (a, b, g) => {
    tint.set(groups[g].color);
    const steps = 6;
    let prev = a;
    for (let s = 1; s <= steps; s++) {
      const next = a.clone().lerp(b, s / steps).normalize().multiplyScalar(R * 1.004);
      line.push(prev.x, prev.y, prev.z, next.x, next.y, next.z);
      lineColor.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
      lineGroup.push(g, g);
      prev = next;
    }
  };
  for (const skill of skills) {
    const mates = skills.filter((o) => o.group === skill.group && o !== skill)
      .sort((p, q) => p.pos.distanceToSquared(skill.pos) - q.pos.distanceToSquared(skill.pos))
      .slice(0, 2);
    for (const mate of mates) {
      const key = Math.min(skill.index, mate.index) + ':' + Math.max(skill.index, mate.index);
      if (seen.has(key)) continue;
      seen.add(key);
      arc(skill.pos, mate.pos, skill.group);
    }
  }
  const gridTint = new Color(PALETTE[0]);
  const ring = (fn) => {
    const steps = 72;
    for (let s = 0; s < steps; s++) {
      const a = fn(s / steps * TAU), b = fn((s + 1) / steps * TAU);
      line.push(a.x, a.y, a.z, b.x, b.y, b.z);
      lineColor.push(gridTint.r, gridTint.g, gridTint.b, gridTint.r, gridTint.g, gridTint.b);
      lineGroup.push(-2, -2);
    }
  };
  for (const lat of [-0.55, 0, 0.55]) {
    const y = Math.sin(lat) * R, r = Math.cos(lat) * R;
    ring((t) => new Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
  }
  for (const lon of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    ring((t) => new Vector3(Math.cos(t) * Math.cos(lon) * R, Math.sin(t) * R, Math.cos(t) * Math.sin(lon) * R));
  }
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute('position', new BufferAttribute(new Float32Array(line), 3));
  lineGeometry.setAttribute('color', new BufferAttribute(new Float32Array(lineColor), 3));
  lineGeometry.setAttribute('aGroup', new BufferAttribute(new Float32Array(lineGroup), 1));
  const lineMaterial = new ShaderMaterial({
    uniforms: { uActive: uniforms.uActive }, vertexShader: linesVertex, fragmentShader: linesFragment,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });

  const globe = new Group();
  globe.add(new LineSegments(lineGeometry, lineMaterial));
  globe.add(new Points(pointGeometry, pointMaterial));
  const scene = new Scene();
  scene.add(globe);
  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0, 5.6);

  const labels = skills.map((skill) => {
    const el = document.createElement('span');
    el.className = 'skills__label';
    el.textContent = skill.name;
    el.style.setProperty('--g', groups[skill.group].color);
    el.dataset.skill = skill.index;
    layer.append(el);
    return { el, shown: -1, live: false };
  });

  const view = { yaw: 0.4, pitch: 0.18, spin: 0, target: null };
  let width = 0, height = 0;
  let active = -1, hover = -1;
  const world = new Vector3();

  function aimAt(point) {
    let yaw = Math.atan2(-point.x, point.z);
    const flat = Math.hypot(point.x, point.z);
    const pitch = Math.atan2(point.y, flat);
    yaw += Math.round((view.yaw - yaw) / TAU) * TAU;   // the short way round
    view.target = { yaw, pitch: Math.max(-1.1, Math.min(1.1, pitch)) };
  }

  function placeLabels() {
    globe.updateMatrixWorld();
    for (let k = 0; k < skills.length; k++) {
      world.copy(skills[k].pos).applyMatrix4(globe.matrixWorld);
      const front = (world.z / R + 1) / 2;               // 0 = back, 1 = front
      world.project(camera);
      const x = (world.x * 0.5 + 0.5) * width;
      const y = (-world.y * 0.5 + 0.5) * height;
      const s = skills[k];
      const lit = k === hover;
      const inGroup = active === -1 || s.group === active;
      const edge = active !== -1 && inGroup ? 0.35 : 0.62;
      let opacity = Math.max(0, Math.min(1, (front - edge) / 0.18));
      if (!inGroup) opacity *= 0.25;
      if (lit) opacity = 1;
      const label = labels[k];
      const shown = Math.round(opacity * 40) / 40;
      if (shown === 0 && label.shown === 0) continue;
      label.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -150%) scale(${(0.82 + front * 0.22).toFixed(3)})`;
      if (shown !== label.shown) {
        label.shown = shown;
        label.el.style.opacity = shown;
        const live = shown > 0.4;
        if (live !== label.live) { label.live = live; label.el.style.pointerEvents = live ? 'auto' : 'none'; }
      }
    }
  }

  function render() {
    globe.rotation.set(view.pitch, view.yaw, 0);
    renderer.render(scene, camera);
    placeLabels();
  }

  function resize() {
    width = stage.clientWidth; height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }
  new ResizeObserver(resize).observe(stage);

  function highlight(group, skill = -1) {
    active = group; hover = skill;
    uniforms.uActive.value = group; uniforms.uHover.value = skill;
    groups.forEach((g, i) => {
      g.el.classList.toggle('is-active', group === i);
      g.el.classList.toggle('is-dim', group !== -1 && group !== i);
    });
    skills.forEach((s, i) => {
      s.chip.classList.toggle('is-lit', i === skill);
      labels[i].el.classList.toggle('is-hot', i === skill);
    });
    if (skill !== -1) aimAt(skills[skill].pos);
    else if (group !== -1) aimAt(groups[group].centre);
    else view.target = null;
    wake();
  }
  let clearTimer = 0;
  const clearSoon = () => { clearTimeout(clearTimer); clearTimer = setTimeout(() => highlight(-1), 500); };
  const hold = () => clearTimeout(clearTimer);

  groups.forEach((group, g) => {
    group.el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hold(); highlight(g); } });
    group.el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') clearSoon(); });
    group.el.addEventListener('click', (e) => {
      const chip = e.target.closest('dd');
      const k = chip ? Number(chip.dataset.skill) : -1;
      if (k !== -1 ? hover === k : active === g && hover === -1) highlight(-1);
      else highlight(g, k);
    });
    group.chips.forEach((chip) => {
      chip.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hold(); highlight(g, Number(chip.dataset.skill)); } });
      chip.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') highlight(g); });
    });
  });
  layer.addEventListener('pointerover', (e) => {
    const el = e.target.closest('.skills__label');
    if (!el) return;
    hold();
    const k = Number(el.dataset.skill);
    highlight(skills[k].group, k);
  });
  layer.addEventListener('pointerout', (e) => { if (e.target.closest('.skills__label')) clearSoon(); });

  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.skills__label')) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    view.target = null;
    stage.setPointerCapture(e.pointerId);
    wake();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    const now = performance.now();
    const k = 3 / Math.max(width, 1);
    view.yaw += dx * k;
    view.pitch = Math.max(-0.9, Math.min(0.9, view.pitch + dy * k));
    view.spin = (dx * k) / Math.max((now - drag.t) / 1000, 0.008);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    render();
  });
  const endDrag = () => { drag = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  const AUTO = still ? 0 : 0.16;          // radians per second of idle drift
  let last = 0, clock = 0, running = false, onScreen = false;
  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - (last || now)) / 1000, 0.05);
    last = now;
    clock += dt;
    uniforms.uTime.value = clock;
    if (!drag) {
      if (view.target) {
        const ease = 1 - Math.exp(-dt * 5);
        view.yaw += (view.target.yaw - view.yaw) * ease;
        view.pitch += (view.target.pitch - view.pitch) * ease;
        view.spin = 0;
      } else {
        view.yaw += (AUTO + view.spin) * dt;
        view.spin *= Math.exp(-dt * 2.5);
        view.pitch += (0.18 - view.pitch) * (1 - Math.exp(-dt * 1.2));
      }
    }
    render();
    requestAnimationFrame(frame);
  }
  function wake() {
    const should = onScreen && !document.hidden;
    if (should && !running) { running = true; last = 0; requestAnimationFrame(frame); }
    else if (!should) running = false;
  }
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; wake(); }).observe(stage);
  document.addEventListener('visibilitychange', wake);

  resize();
  await renderer.compileAsync(scene, camera).catch(() => {});
  render();
  canvas.classList.add('is-live');
  root.classList.add('is-live');
  return true;
}
