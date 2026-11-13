/*
 * Contact orb: a sphere of particles that breathes with 3D noise, wrapped by
 * a tilted orbit ring. Violet at rest, coral where the surface swells.
 * Leans toward the pointer; animates only while on screen.
 *
 * script.js loads this module on demand, in idle time.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute,
  Points, ShaderMaterial, Color, Group, IcosahedronGeometry, AdditiveBlending,
} from './vendor/three.module.min.js';
import { SIMPLEX_NOISE } from './terrain.js';
import { createLean } from './lean.js';

const vertexShader = /* glsl */ `
  ${SIMPLEX_NOISE}
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uRing;        // 1 for the orbit ring, 0 for the sphere
  attribute float aSeed;
  varying float vHeat;
  varying float vSeed;

  void main() {
    vec3 p = position;
    float heat = 0.0;
    if (uRing < 0.5) {
      // Swell the sphere outward along its normal by slow 3D noise.
      float n = snoise(p * 0.9 + vec3(0.0, uTime * 0.25, uTime * 0.15));
      heat = smoothstep(0.1, 0.9, n);
      p += normalize(p) * n * 0.32;
    } else {
      // Ring particles drift along the orbit at their own speed.
      float a = atan(p.z, p.x) + uTime * (0.08 + aSeed * 0.06);
      float r = length(p.xz);
      p = vec3(cos(a) * r, p.y + sin(uTime + aSeed * 6.28) * 0.04, sin(a) * r);
      heat = step(0.9, aSeed);
    }
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uSize * uPixelRatio * (0.6 + aSeed * 0.8) / -viewPosition.z;
    vHeat = heat;
    vSeed = aSeed;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  varying float vHeat;
  varying float vSeed;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(mix(uColor, uHot, vHeat), alpha * (0.55 + vSeed * 0.45));
  }
`;

function seeds(count) {
  const array = new Float32Array(count);
  for (let i = 0; i < count; i++) array[i] = Math.random();
  return array;
}

function ringPositions(count) {
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.45 + (Math.random() - 0.5) * 0.35;
    array.set([Math.cos(a) * r, (Math.random() - 0.5) * 0.06, Math.sin(a) * r], i * 3);
  }
  return array;
}

export async function mountOrb(canvas, { gsap, ScrollTrigger, still = false } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  } catch {
    return false;
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
  renderer.setPixelRatio(pixelRatio);

  const styles = getComputedStyle(document.documentElement);
  const color = new Color(styles.getPropertyValue('--lime').trim() || '#8b7bff');
  const hot = new Color(styles.getPropertyValue('--coral').trim() || '#ff6b8b');

  const makeMaterial = (ring, size) => new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSize: { value: size }, uPixelRatio: { value: pixelRatio },
      uRing: { value: ring }, uColor: { value: color }, uHot: { value: hot },
    },
    vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: AdditiveBlending,
  });

  // Sphere: the vertices of a finely divided icosahedron, de-duplicated by
  // dropping the index (non-indexed geometry repeats shared corners; harmless for points).
  const sphere = new IcosahedronGeometry(1.5, 28);
  sphere.deleteAttribute('normal');
  sphere.deleteAttribute('uv');
  sphere.setAttribute('aSeed', new BufferAttribute(seeds(sphere.attributes.position.count), 1));
  const sphereMaterial = makeMaterial(0, 22);

  const ringCount = 2200;
  const ring = new BufferGeometry();
  ring.setAttribute('position', new BufferAttribute(ringPositions(ringCount), 3));
  ring.setAttribute('aSeed', new BufferAttribute(seeds(ringCount), 1));
  const ringMaterial = makeMaterial(1, 18);

  const ringPoints = new Points(ring, ringMaterial);
  ringPoints.rotation.set(1.15, 0, 0.35);

  const group = new Group();
  group.add(new Points(sphere, sphereMaterial), ringPoints);
  const scene = new Scene();
  scene.add(group);
  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0, 8.5);

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (still) render();
  }

  // Motion = a steady drift from the clock + the scroll position: scrolling down pushes the orb forward,
  // scrolling back reverses it, in step with the page.
  const SPAN = 16;                    // seconds of motion added across one scroll pass
  let clock = 0;                      // GSAP ticker time, in seconds
  const scrollState = { target: 0.5, current: 0.5 };

  function render() {
    const p = scrollState.current;
    // Steady motion from the clock, plus the scroll position on top.
    const t = clock * 0.6 + p * SPAN;
    sphereMaterial.uniforms.uTime.value = t;
    ringMaterial.uniforms.uTime.value = t;
    group.rotation.y = t * 0.15;
    const grow = Math.min(1, Math.max(0, (p - 0.05) / 0.3));
    group.scale.setScalar(still ? 1 : 0.2 + 0.8 * (1 - (1 - grow) ** 3));
    renderer.render(scene, camera);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  // Compile shaders off the main thread (KHR_parallel_shader_compile)
  // instead of freezing the page for the first frame.
  await renderer.compileAsync(scene, camera).catch(() => {});
  render();
  canvas.classList.add('is-live');
  if (still || !gsap || !ScrollTrigger) return true;

  ScrollTrigger.create({
    trigger: canvas.parentElement, start: 'top bottom', end: 'bottom top',
    onUpdate: (self) => { scrollState.target = self.progress; },
    onRefresh: (self) => { scrollState.target = self.progress; scrollState.current = self.progress; },
  });

  // The orb leans toward the mouse, a finger, or the phone's tilt (see lean.js).
  const read = createLean(canvas.parentElement);
  const tiltX = gsap.quickTo(group.rotation, 'x', { duration: 1, ease: 'power3.out' });
  const tiltZ = gsap.quickTo(group.rotation, 'z', { duration: 1, ease: 'power3.out' });

  // Loop on GSAP's ticker, paused while off screen or in a background tab.
  // Each frame eases the orb's progress toward the scroll position.
  let lastFrame = 0;
  const tick = (time) => {
    if (time - lastFrame < 1 / 32) return;   // ~30 fps is plenty for a decorative scene
    lastFrame = time;
    clock = time;
    scrollState.current += (scrollState.target - scrollState.current) * 0.14;
    const lean = read(time);
    tiltZ(-lean.x * 0.3);
    tiltX(lean.y * 0.3);
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
