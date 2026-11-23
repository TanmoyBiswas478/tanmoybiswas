import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute,
  Points, ShaderMaterial, AdditiveBlending, Color, Group, Raycaster, Vector2, Vector3, Sphere,
} from './vendor/three.module.min.js';
import { createLean } from './lean.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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
  uniform float uBlastAt;     // uTime of the last click (-100 = none)
  uniform vec3 uOrigin;       // where the click hit, in the shape's own space

  varying float vSeed;
  varying float vFlight;
  varying float vBlast;

  void main() {
    float toHelix = smoothstep(0.0, 1.0, clamp(uMorph, 0.0, 1.0));
    float toWave = smoothstep(0.0, 1.0, clamp(uMorph - 1.0, 0.0, 1.0));
    vec3 p = mix(mix(position, aHelix, toHelix), aWave, toWave);

    float flight = sin(toHelix * 3.14159) + sin(toWave * 3.14159);
    p += normalize(p + vec3(0.0001)) * flight * (0.5 + aSeed * 1.6);

    p.y += sin(uTime * 0.9 + aSeed * 6.2831) * 0.035;

    // Shockwave from the clicked point. Each particle reacts when the wavefront
    // reaches it (so the hit spreads across the shape), kicks out fast, then
    // eases home on its own clock, so the shape re-forms grain by grain.
    vec3 away = p - uOrigin;
    float dist = length(away);
    float local = uTime - uBlastAt - dist * 0.09;
    float kick = local > 0.0 ? (1.0 - exp(-local * 14.0)) * exp(-local * (1.5 + aSeed * 1.3)) : 0.0;
    float strength = mix(0.22, 1.0, exp(-dist * 0.75));
    float reach = kick * strength;
    vec3 scatter = vec3(fract(aSeed * 13.1), fract(aSeed * 7.7), fract(aSeed * 3.3)) - 0.5;
    vec3 dir = normalize(normalize(away + vec3(0.0001)) * 0.7 + normalize(p + vec3(0.0001)) * 0.3 + scatter * 0.7);
    p += dir * reach * (1.6 + aSeed * 2.6);
    float front = local > -0.05 ? exp(-pow(local * 7.0, 2.0)) * strength : 0.0;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uSize * uPixelRatio * (0.55 + aSeed) / -viewPosition.z;

    vSeed = aSeed;
    vFlight = flight;
    vBlast = max(reach, front);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSpark;

  varying float vSeed;
  varying float vFlight;
  varying float vBlast;

  void main() {
    float distanceFromCentre = length(gl_PointCoord - 0.5);
    if (distanceFromCentre > 0.5) discard;
    float alpha = smoothstep(0.5, 0.05, distanceFromCentre);
    vec3 colour = mix(vSeed > 0.93 ? uSpark : uColor, uSpark, clamp(vBlast * 1.4, 0.0, 0.85));
    gl_FragColor = vec4(colour, alpha * (0.7 + vFlight * 0.3 + vBlast * 0.6));
  }
`;

export async function mountStory(canvas, { state = { morph: 0 }, gsap, still = false } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
    renderer.debug.checkShaderErrors = false; // no blocking shader-status queries
  } catch {
    return false;
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
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
    uColor: { value: new Color(styles.getPropertyValue('--lime').trim() || '#8b7bff') },
    uSpark: { value: new Color(styles.getPropertyValue('--coral').trim() || '#ff6b8b') },
    uBlastAt: { value: -100 },
    uOrigin: { value: new Vector3() },
  };

  const points = new Points(geometry, new ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  }));

  const group = new Group();
  group.add(points);
  const scene = new Scene();
  scene.add(group);
  const camera = new PerspectiveCamera(45, 1, 0.1, 50);

  let placeHint = null; // assigned below, once the hint exists

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const narrow = camera.aspect < 0.9;
    group.position.set(narrow ? 0 : 2.2, narrow ? 2.3 : 0, 0);
    group.scale.setScalar(narrow ? 0.68 : 1);
    camera.position.set(0, 0, narrow ? 11 : 7.5);
    camera.updateProjectionMatrix();
    placeHint?.();
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
  await renderer.compileAsync(scene, camera).catch(() => {});
  render();
  canvas.classList.add('is-live');
  if (still) return true;

  let onScreen = true;
  let steer = null; // assigned below
  const tick = (time) => {
    steer?.(time);
    render(time * 1000);
  };
  let ticking = false;
  const updateLoop = () => {
    const on = onScreen && !document.hidden;
    if (!gsap) {
      renderer.setAnimationLoop(on ? render : null);
      return;
    }
    if (on === ticking) return;
    ticking = on;
    if (on) gsap.ticker.add(tick);
    else gsap.ticker.remove(tick);
  };
  let entered = false;
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    updateLoop();
    if (onScreen && !entered && gsap) {
      entered = true;
      gsap.to(uniforms.uSize, { value: 34, duration: 1.8, ease: 'expo.out' });
    }
  }).observe(canvas);
  document.addEventListener('visibilitychange', updateLoop);
  updateLoop();

  if (!gsap) return true;

  const tiltX = gsap.quickTo(group.rotation, 'x', { duration: 1, ease: 'power3.out' });
  const tiltY = gsap.quickTo(group.rotation, 'y', { duration: 1, ease: 'power3.out' });
  const read = createLean(canvas.closest('[data-story]') ?? canvas);
  steer = (time) => {
    const lean = read(time);
    tiltY(lean.x * 0.35);
    tiltX(lean.y * 0.25);
  };

  makeBreakable({ canvas, camera, group, points, uniforms, setPlaceHint: (fn) => { placeHint = fn; } });
  return true;
}

// Click (or tap) the shape: a shockwave from that point, then it re-forms.
function makeBreakable({ canvas, camera, group, points, uniforms, setPlaceHint }) {
  const stage = canvas.parentElement;
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
    bounds.radius = 2.6 * group.scale.x;
    return raycaster.ray.intersectSphere(bounds, hit);
  };

  const hint = document.createElement('p');
  hint.className = 'scene-hint';
  hint.setAttribute('aria-hidden', 'true');
  const touch = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  hint.textContent = touch ? 'Tap to break it apart' : 'Click to break it apart';
  stage.append(hint);
  const place = () => {
    below.set(group.position.x, group.position.y - 2.9 * group.scale.x, 0).project(camera);
    hint.style.left = `${((below.x + 1) / 2) * canvas.clientWidth}px`;
    hint.style.top = `${((1 - below.y) / 2) * canvas.clientHeight}px`;
  };
  setPlaceHint(place);
  place();

  // The hint is there whenever the scene is on screen; it steps aside during
  // a blast and comes back once the shape has re-formed.
  let inView = false;
  let resting = true;
  let restTimer = 0;
  const sync = () => hint.classList.toggle('is-on', inView && resting);
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  }, { threshold: 0.35 }).observe(stage);

  // Coral cursor over the shape, so it reads as clickable.
  let queued = null;
  stage.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const first = !queued;
    queued = event;
    if (first) requestAnimationFrame(() => { stage.toggleAttribute('data-hot', Boolean(pick(queued.clientX, queued.clientY))); queued = null; });
  }, { passive: true });
  stage.addEventListener('pointerleave', () => stage.removeAttribute('data-hot'));

  stage.addEventListener('click', (event) => { // click, not pointerdown: a scroll swipe on a phone never fires it
    if (event.target.closest('a, button')) return;
    if (!pick(event.clientX, event.clientY)) return;
    uniforms.uOrigin.value.copy(points.worldToLocal(hit));
    uniforms.uBlastAt.value = uniforms.uTime.value; // the shader runs the whole effect from here
    resting = false;
    sync();
    clearTimeout(restTimer);
    restTimer = setTimeout(() => { resting = true; sync(); }, 2800);
  });
}
