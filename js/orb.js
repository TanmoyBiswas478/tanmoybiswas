import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute,
  Points, ShaderMaterial, Color, Group, IcosahedronGeometry, AdditiveBlending,
  Raycaster, Vector2, Vector3, Sphere,
} from './vendor/three.module.min.js';
import { SIMPLEX_NOISE } from './terrain.js';
import { createLean } from './lean.js';

const vertexShader = /* glsl */ `
  ${SIMPLEX_NOISE}
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uRing;        // 1 for the orbit ring, 0 for the sphere
  uniform float uPing;        // 0..1 while a ping travels, set by a click
  uniform vec3 uPingDir;      // where the ping started, on the sphere
  attribute float aSeed;
  varying float vHeat;
  varying float vSeed;

  void main() {
    vec3 p = position;
    float heat = 0.0;
    if (uRing < 0.5) {
      float n = snoise(p * 0.9 + vec3(0.0, uTime * 0.25, uTime * 0.15));
      heat = smoothstep(0.1, 0.9, n);
      p += normalize(p) * n * 0.32;
      // The ping: a ripple that spreads over the surface from the tapped point.
      float d = distance(normalize(position), uPingDir);
      float wave = exp(-pow((d - uPing * 2.2) * 3.5, 2.0)) * (1.0 - uPing) * step(0.001, uPing);
      p += normalize(p) * wave * 0.55;
      heat = max(heat, wave);
    } else {
      float a = atan(p.z, p.x) + uTime * (0.08 + aSeed * 0.06);
      float r = length(p.xz);
      float pulse = sin(uPing * 3.14159);
      r *= 1.0 + pulse * 0.18;
      p = vec3(cos(a) * r, p.y + sin(uTime + aSeed * 6.28) * 0.04, sin(a) * r);
      heat = max(step(0.9, aSeed), pulse * 0.7);
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
    renderer.debug.checkShaderErrors = false; // no blocking shader-status queries
  } catch {
    return false;
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
  renderer.setPixelRatio(pixelRatio);

  const styles = getComputedStyle(document.documentElement);
  const color = new Color(styles.getPropertyValue('--lime').trim() || '#8b7bff');
  const hot = new Color(styles.getPropertyValue('--coral').trim() || '#ff6b8b');

  const ping = { uPing: { value: 0 }, uPingDir: { value: new Vector3(0, 0, 1) } }; // shared by both materials
  const makeMaterial = (ring, size) => new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSize: { value: size }, uPixelRatio: { value: pixelRatio },
      uRing: { value: ring }, uColor: { value: color }, uHot: { value: hot }, ...ping,
    },
    vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: AdditiveBlending,
  });

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

  const spherePoints = new Points(sphere, sphereMaterial);
  const group = new Group();
  group.add(spherePoints, ringPoints);
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

  const SPAN = 16;                    // seconds of motion added across one scroll pass
  let clock = 0;                      // GSAP ticker time, in seconds
  const scrollState = { target: 0.5, current: 0.5 };

  function render() {
    const p = scrollState.current;
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
  await renderer.compileAsync(scene, camera).catch(() => {});
  render();
  canvas.classList.add('is-live');
  if (still || !gsap || !ScrollTrigger) return true;

  ScrollTrigger.create({
    trigger: canvas.parentElement, start: 'top bottom', end: 'bottom top',
    onUpdate: (self) => { scrollState.target = self.progress; },
    onRefresh: (self) => { scrollState.target = self.progress; scrollState.current = self.progress; },
  });

  const read = createLean(canvas.parentElement);
  const tiltX = gsap.quickTo(group.rotation, 'x', { duration: 1, ease: 'power3.out' });
  const tiltZ = gsap.quickTo(group.rotation, 'z', { duration: 1, ease: 'power3.out' });

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

  // On phones the orb sits behind the contact details: keep it decorative there.
  if (!window.matchMedia('(max-width: 760px)').matches) makePingable({ canvas, camera, group, spherePoints, ping, gsap });
  return true;
}

// Click (or tap) the orb: a ripple spreads over it, the ring pulses outward
// like a signal, and the email address lights up.
function makePingable({ canvas, camera, group, spherePoints, ping, gsap }) {
  const section = canvas.parentElement;
  const address = section.querySelector('.contact__address');
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const hit = new Vector3();
  const bounds = new Sphere(new Vector3(), 1);
  const below = new Vector3();

  const pick = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    group.updateMatrixWorld();
    bounds.center.setFromMatrixPosition(group.matrixWorld);
    bounds.radius = 1.75 * group.scale.x;
    return raycaster.ray.intersectSphere(bounds, hit);
  };

  const hint = document.createElement('p');
  hint.className = 'scene-hint';
  hint.setAttribute('aria-hidden', 'true');
  const touch = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  hint.textContent = touch ? 'Tap the orb to send a ping' : 'Click the orb to send a ping';
  section.append(hint);
  const place = () => {
    below.set(0, -2.15, 0).project(camera);
    const x = canvas.offsetLeft + ((below.x + 1) / 2) * canvas.clientWidth;
    const y = canvas.offsetTop + ((1 - below.y) / 2) * canvas.clientHeight;
    hint.style.left = `${Math.min(Math.max(x, 120), section.clientWidth - 120)}px`;
    hint.style.top = `${y}px`;
  };
  new ResizeObserver(place).observe(canvas);

  // Shown whenever the orb is on screen; steps aside while a ping runs.
  let inView = false;
  let resting = true;
  let restTimer = 0;
  const sync = () => hint.classList.toggle('is-on', inView && resting);
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) place();
    sync();
  }, { threshold: 0.5 }).observe(canvas);

  let queued = null;
  section.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const first = !queued;
    queued = event;
    if (first) {
      requestAnimationFrame(() => {
        const over = !queued.target.closest('a, button') && Boolean(pick(queued.clientX, queued.clientY));
        section.toggleAttribute('data-hot', over);
        queued = null;
      });
    }
  }, { passive: true });
  section.addEventListener('pointerleave', () => section.removeAttribute('data-hot'));

  let lit = 0;
  section.addEventListener('click', (event) => {
    if (event.target.closest('a, button, input, [data-copy]')) return;
    if (!pick(event.clientX, event.clientY)) return;
    ping.uPingDir.value.copy(spherePoints.worldToLocal(hit)).normalize();
    gsap.killTweensOf(ping.uPing);
    gsap.fromTo(ping.uPing, { value: 0 }, { value: 1, duration: 1.6, ease: 'power2.out' });
    if (address) {
      clearTimeout(lit);
      lit = setTimeout(() => {
        address.classList.add('is-pinged');
        lit = setTimeout(() => address.classList.remove('is-pinged'), 1600);
      }, 450);
    }
    resting = false;
    sync();
    clearTimeout(restTimer);
    restTimer = setTimeout(() => { resting = true; sync(); }, 2200);
  });
}
