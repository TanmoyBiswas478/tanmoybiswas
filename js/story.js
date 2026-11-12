/*
 * Story scene: a cloud of particles that morphs between three shapes as the
 * pinned "story" section scrolls: a sphere (workflows), a double helix
 * (integrations) and a rolling wave field (machine learning).
 *
 * All three shapes live on the GPU as vertex attributes. script.js scrubs a
 * single number, state.morph (0 → 1 → 2), and the vertex shader blends
 * between the shapes, scattering the particles outward mid-transition and
 * letting them settle again.
 *
 * script.js loads this module when the section comes near the viewport.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute,
  Points, ShaderMaterial, AdditiveBlending, Color, Group,
} from './vendor/three.module.min.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Evenly spread points over a sphere (Fibonacci lattice), with a little depth jitter. */
function sphereShape(count) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * i;
    const scale = 2.3 * (0.94 + Math.random() * 0.12);
    out.set([Math.cos(theta) * radius * scale, y * scale, Math.sin(theta) * radius * scale], i * 3);
  }
  return out;
}

/** Two twisting strands, with every fifth particle on a rung between them. */
function helixShape(count) {
  const out = new Float32Array(count * 3);
  const turns = 3.2;
  const height = 5.4;
  const radius = 1.15;
  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const angle = t * Math.PI * 2 * turns;
    const y = (t - 0.5) * height;
    const jitter = () => (Math.random() - 0.5) * 0.08;

    if (i % 5 === 0) {
      const along = Math.random() * 2 - 1; // -1..1 across the rung
      out.set([Math.cos(angle) * radius * along, y, Math.sin(angle) * radius * along], i * 3);
    } else {
      const strand = i % 2 === 0 ? 0 : Math.PI;
      out.set([Math.cos(angle + strand) * radius + jitter(), y + jitter(), Math.sin(angle + strand) * radius + jitter()], i * 3);
    }
  }
  return out;
}

/** A gently rolling field of particles on a grid. */
function waveShape(count) {
  const out = new Float32Array(count * 3);
  const columns = Math.ceil(Math.sqrt(count * 1.7));
  const rows = Math.ceil(count / columns);
  for (let i = 0; i < count; i++) {
    const u = (i % columns) / (columns - 1) - 0.5;
    const v = Math.floor(i / columns) / Math.max(rows - 1, 1) - 0.5;
    const x = u * 4.6;
    const z = v * 3.8;
    const y = Math.sin(x * 1.3) * 0.38 + Math.cos(z * 2.1 + x * 0.6) * 0.3;
    out.set([x, y, z], i * 3);
  }
  return out;
}

const vertexShader = /* glsl */ `
  attribute vec3 aHelix;
  attribute vec3 aWave;
  attribute float aSeed;

  uniform float uMorph;       // 0 = sphere, 1 = helix, 2 = wave
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;

  varying float vSeed;
  varying float vFlight;

  void main() {
    float toHelix = smoothstep(0.0, 1.0, clamp(uMorph, 0.0, 1.0));
    float toWave = smoothstep(0.0, 1.0, clamp(uMorph - 1.0, 0.0, 1.0));
    vec3 p = mix(mix(position, aHelix, toHelix), aWave, toWave);

    // Mid-transition the particles burst outward, each by its own amount, then settle.
    float flight = sin(toHelix * 3.14159) + sin(toWave * 3.14159);
    p += normalize(p + vec3(0.0001)) * flight * (0.5 + aSeed * 1.6);

    // A slow shimmer so the shape never looks frozen.
    p.y += sin(uTime * 0.9 + aSeed * 6.2831) * 0.035;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uSize * uPixelRatio * (0.55 + aSeed) / -viewPosition.z;

    vSeed = aSeed;
    vFlight = flight;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSpark;

  varying float vSeed;
  varying float vFlight;

  void main() {
    // Soft round dots; a few particles are white sparks among the lime.
    float distanceFromCentre = length(gl_PointCoord - 0.5);
    if (distanceFromCentre > 0.5) discard;
    float alpha = smoothstep(0.5, 0.05, distanceFromCentre);
    vec3 colour = vSeed > 0.93 ? uSpark : uColor;
    gl_FragColor = vec4(colour, alpha * (0.7 + vFlight * 0.3));
  }
`;

/**
 * Start the scene on `canvas`. Returns false when WebGL is unavailable.
 *
 * Options:
 *  - state: object whose `morph` (0..2) script.js scrubs with the scroll
 *  - gsap:  used for the entrance and for easing pointer movement (optional)
 *  - still: render a single frame and never animate (reduced motion)
 */
export function mountStory(canvas, { state = { morph: 0 }, gsap, still = false } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  } catch {
    return false;
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pixelRatio);

  const phone = window.matchMedia('(max-width: 760px)').matches;
  const count = phone ? 5000 : 9000;

  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random();

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(sphereShape(count), 3));
  geometry.setAttribute('aHelix', new BufferAttribute(helixShape(count), 3));
  geometry.setAttribute('aWave', new BufferAttribute(waveShape(count), 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));

  const styles = getComputedStyle(document.documentElement);
  const uniforms = {
    uMorph: { value: state.morph },
    uTime: { value: 0 },
    uSize: { value: still || !gsap ? 34 : 0 },
    uPixelRatio: { value: pixelRatio },
    uColor: { value: new Color(styles.getPropertyValue('--lime').trim() || '#d2ff00') },
    uSpark: { value: new Color('#ffffff') },
  };

  const points = new Points(geometry, new ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  }));

  // The group carries the layout offset and the pointer tilt; the points spin inside it.
  const group = new Group();
  group.add(points);
  const scene = new Scene();
  scene.add(group);
  const camera = new PerspectiveCamera(45, 1, 0.1, 50);

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Wide screens: the shape sits to the right of the text. Narrow screens:
    // smaller, and lifted into the space above the captions.
    const narrow = camera.aspect < 0.9;
    group.position.set(narrow ? 0 : 2.2, narrow ? 2.3 : 0, 0);
    group.scale.setScalar(narrow ? 0.68 : 1);
    camera.position.set(0, 0, narrow ? 11 : 7.5);
    camera.updateProjectionMatrix();
    if (still) render();
  }

  function render(timeMs = 0) {
    const seconds = timeMs / 1000;
    uniforms.uTime.value = seconds;
    uniforms.uMorph.value = state.morph;
    points.rotation.y = seconds * 0.12;
    points.rotation.x = Math.sin(seconds * 0.2) * 0.12;
    renderer.render(scene, camera);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  render();
  canvas.classList.add('is-live');
  if (still) return true;

  // Animation loop, paused while off screen or in a background tab.
  let onScreen = true;
  const updateLoop = () => renderer.setAnimationLoop(onScreen && !document.hidden ? render : null);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    updateLoop();
  }).observe(canvas);
  document.addEventListener('visibilitychange', updateLoop);
  updateLoop();

  if (!gsap) return true;

  // Entrance: the particles bloom from nothing to full size.
  gsap.to(uniforms.uSize, { value: 34, duration: 1.8, ease: 'expo.out' });

  // The whole shape leans toward the pointer.
  const tiltX = gsap.quickTo(group.rotation, 'x', { duration: 1, ease: 'power3.out' });
  const tiltY = gsap.quickTo(group.rotation, 'y', { duration: 1, ease: 'power3.out' });
  const section = canvas.closest('[data-story]') ?? canvas;
  section.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    tiltY(((event.clientX / window.innerWidth) * 2 - 1) * 0.35);
    tiltX(((event.clientY / window.innerHeight) * 2 - 1) * 0.25);
  }, { passive: true });
  section.addEventListener('pointerleave', () => {
    tiltX(0);
    tiltY(0);
  });

  return true;
}
