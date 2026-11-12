/*
 * Small decorative Three.js scenes, one per section heading (and the footer).
 * Every scene is a particle field drawn by one shared shader; each kind only
 * supplies its starting positions and a GLSL `move()` that animates a point.
 * Violet blends into coral across each shape (the site's two accents).
 *
 * Each scene animates only while on screen, leans toward the pointer and
 * scales in the first time it is seen. script.js loads this module on demand.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points,
  LineSegments, LineBasicMaterial, ShaderMaterial, Color, Group, AdditiveBlending, NormalBlending,
} from './vendor/three.module.min.js';
import { createLean } from './lean.js';

const TAU = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);

/* -- Shapes: each returns { positions, mix } (mix 0..1 = violet..coral) -- */

/** Systems network: nodes on a sphere, the nearest ones wired together. */
function network() {
  const count = 140;
  const positions = new Float32Array(count * 3);
  const mix = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;              // Fibonacci sphere: even spacing
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    const s = 1.9 + rand(-0.12, 0.12);
    positions.set([Math.cos(a) * r * s, y * s, Math.sin(a) * r * s], i * 3);
    mix[i] = (y + 1) / 2;
  }
  // Wire each node to its two nearest neighbours.
  const lines = [];
  for (let i = 0; i < count; i++) {
    const near = [];
    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const dx = positions[i * 3] - positions[j * 3];
      const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
      near.push([dx * dx + dy * dy + dz * dz, j]);
    }
    near.sort((p, q) => p[0] - q[0]);
    for (const [, j] of near.slice(0, 2)) {
      lines.push(...positions.slice(i * 3, i * 3 + 3), ...positions.slice(j * 3, j * 3 + 3));
    }
  }
  return { positions, mix, lines: new Float32Array(lines), size: 70 };
}

/** Wave grid: a tilted plane of points rolling like water. */
function waves() {
  const side = 64;
  const positions = new Float32Array(side * side * 3);
  const mix = new Float32Array(side * side);
  for (let x = 0; x < side; x++) {
    for (let z = 0; z < side; z++) {
      const i = x * side + z;
      positions.set([(x / (side - 1) - 0.5) * 5.2, 0, (z / (side - 1) - 0.5) * 5.2], i * 3);
      mix[i] = x / (side - 1);
    }
  }
  return { positions, mix, size: 26 };
}

/** Torus knot: points flowing along a (2,3) knot. */
function knot() {
  const count = 4200;
  const positions = new Float32Array(count * 3);
  const mix = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * TAU;
    const r = 1.25 + 0.5 * Math.cos(3 * t);
    const spread = 0.16;
    positions.set([
      r * Math.cos(2 * t) + rand(-spread, spread),
      r * Math.sin(2 * t) + rand(-spread, spread),
      0.55 * Math.sin(3 * t) + rand(-spread, spread),
    ], i * 3);
    mix[i] = (Math.sin(3 * t) + 1) / 2;
  }
  return { positions, mix, size: 22 };
}

/** Timeline tunnel: rings of points that travel toward the viewer. */
function tunnel() {
  const rings = 26;
  const perRing = 90;
  const positions = new Float32Array(rings * perRing * 3);
  const mix = new Float32Array(rings * perRing);
  for (let r = 0; r < rings; r++) {
    for (let p = 0; p < perRing; p++) {
      const i = r * perRing + p;
      const a = (p / perRing) * TAU;
      positions.set([Math.cos(a) * 1.6, Math.sin(a) * 1.6, -(r / rings) * 12], i * 3);
      mix[i] = r / rings;
    }
  }
  return { positions, mix, size: 26 };
}

/** Spiral galaxy: three arms around a bright core. */
function galaxy() {
  const count = 9000;
  const positions = new Float32Array(count * 3);
  const mix = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const radius = Math.pow(Math.random(), 1.6) * 3.4;
    const arm = (i % 3) * (TAU / 3);
    const a = arm + radius * 1.35;
    const scatter = (0.08 + radius * 0.12);
    positions.set([
      Math.cos(a) * radius + rand(-scatter, scatter),
      rand(-scatter, scatter) * 0.5,
      Math.sin(a) * radius + rand(-scatter, scatter),
    ], i * 3);
    mix[i] = Math.min(radius / 3.4 + rand(-0.1, 0.1), 1);
  }
  return { positions, mix, size: 18 };
}

/* -- Per-kind motion (GLSL) and framing -- */

const KINDS = {
  network: {
    build: network,
    move: 'p *= 1.0 + 0.05 * sin(uTime * 1.4 + aSeed * 6.28);',
    camera: 7, tilt: [0.25, 0],
  },
  waves: {
    build: waves,
    move: `p.y = sin(p.x * 1.6 + uTime * 1.2) * 0.28 + cos(p.z * 1.9 + uTime * 0.9) * 0.22;
           mixShift = p.y * 0.8;`,
    camera: 8.4, tilt: [0.62, 0.35],
  },
  knot: {
    build: knot,
    move: `float a = uTime * 0.25;
           p.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xy;
           p += 0.05 * vec3(sin(uTime + aSeed * 9.0), cos(uTime * 1.3 + aSeed * 7.0), 0.0);`,
    camera: 8.2, tilt: [0.4, 0.2],
  },
  tunnel: {
    build: tunnel,
    move: `p.z = mod(p.z + uTime * 1.6, 12.0) - 10.0;
           float twist = p.z * 0.12 + uTime * 0.2;
           p.xy = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * p.xy;
           fade = smoothstep(-10.0, -6.0, p.z) * (1.0 - smoothstep(0.6, 1.8, p.z));`,
    camera: 4.2, tilt: [0, 0],
  },
  galaxy: {
    build: galaxy,
    move: `float r = length(p.xz);
           float a = uTime * (0.35 / (0.6 + r));
           p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;`,
    camera: 6.5, tilt: [0.85, 0], additive: true,
  },
};

const vertexShader = (move) => /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aSeed;
  attribute float aMix;
  varying float vMix;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float mixShift = 0.0;
    float fade = 1.0;
    ${move}
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uSize * uPixelRatio * (0.55 + aSeed * 0.7) / -viewPosition.z;
    vMix = clamp(aMix + mixShift, 0.0, 1.0);
    vAlpha = fade * (0.55 + aSeed * 0.45);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  varying float vMix;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(mix(uColor, uHot, vMix), smoothstep(0.5, 0.1, d) * vAlpha);
  }
`;

export function mountScene(canvas, { kind, gsap, ScrollTrigger, still = false } = {}) {
  const spec = KINDS[kind];
  if (!spec) return false;
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return false;
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);

  const styles = getComputedStyle(document.documentElement);
  const color = new Color(styles.getPropertyValue('--lime').trim() || '#8b7bff');
  const hot = new Color(styles.getPropertyValue('--coral').trim() || '#ff6b8b');

  const shape = spec.build();
  const count = shape.mix.length;
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(shape.positions, 3));
  geometry.setAttribute('aMix', new BufferAttribute(shape.mix, 1));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 }, uSize: { value: shape.size }, uPixelRatio: { value: pixelRatio },
    uColor: { value: color }, uHot: { value: hot },
  };
  const material = new ShaderMaterial({
    uniforms, vertexShader: vertexShader(spec.move), fragmentShader,
    transparent: true, depthWrite: false,
    // Glow only adds light on dark backgrounds; on paper it would vanish.
    blending: spec.additive ? AdditiveBlending : NormalBlending,
  });

  const group = new Group();
  group.add(new Points(geometry, material));
  if (shape.lines) {
    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute('position', new BufferAttribute(shape.lines, 3));
    group.add(new LineSegments(lineGeometry, new LineBasicMaterial({ color, transparent: true, opacity: 0.35 })));
  }
  group.rotation.set(spec.tilt[0], spec.tilt[1], 0);
  const base = { x: group.rotation.x, z: group.rotation.z };

  const scene = new Scene();
  scene.add(group);
  const camera = new PerspectiveCamera(45, 1, 0.1, 60);
  camera.position.set(0, 0, spec.camera);

  // Motion = a steady drift from the clock + the scroll position. `progress`
  // (0..1) is where the section is on its way through the screen: scrolling
  // down pushes the scene forward, scrolling back pulls it back, while it
  // keeps drifting smoothly on its own.
  const SPAN = 14;                    // seconds of motion added across one scroll pass
  let clock = 0;                      // GSAP ticker time, in seconds
  const scrollState = { target: 0.5, current: 0.5 };

  function render() {
    const p = scrollState.current;
    // Steady motion from the clock, plus the scroll position on top: the
    // scene always drifts smoothly, and scrolling pushes it forward or back.
    const t = clock * 0.6 + p * SPAN;
    uniforms.uTime.value = t;
    if (kind !== 'tunnel' && kind !== 'waves') group.rotation.y = spec.tilt[1] + t * 0.18;
    // Grows in over the first third of the pass, and back out in reverse.
    const grow = 0.3 + 0.7 * Math.min(1, Math.max(0, (p - 0.05) / 0.3));
    group.scale.setScalar(still ? 1 : 1 - (1 - grow) ** 3);
    renderer.render(scene, camera);
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (still) render();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  render();
  canvas.classList.add('is-live');
  if (still || !gsap || !ScrollTrigger) return true;

  const area = canvas.closest('section, footer') ?? canvas.parentElement;
  ScrollTrigger.create({
    trigger: area, start: 'top bottom', end: 'bottom top',
    onUpdate: (self) => { scrollState.target = self.progress; },
    onRefresh: (self) => { scrollState.target = self.progress; scrollState.current = self.progress; },
  });

  // Lean toward the mouse, a finger, or the phone's tilt (see lean.js).
  const read = createLean(area);
  const leanX = gsap.quickTo(group.rotation, 'x', { duration: 1, ease: 'power3.out' });
  const leanZ = gsap.quickTo(group.rotation, 'z', { duration: 1, ease: 'power3.out' });

  // Loop on GSAP's ticker, only while on screen and the tab is visible. Each
  // frame eases the scene's progress toward the scroll position.
  const tick = (time) => {
    clock = time;
    scrollState.current += (scrollState.target - scrollState.current) * 0.14;
    const lean = read(time);
    leanZ(base.z - lean.x * 0.25);
    leanX(base.x + lean.y * 0.2);
    render();
  };
  let onScreen = false;
  let ticking = false;
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
