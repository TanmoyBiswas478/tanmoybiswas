import {
  Scene, PerspectiveCamera, BufferGeometry, BufferAttribute,
  LineSegments, ShaderMaterial, Color, Vector2, Vector3, Plane, Raycaster, Group,
} from './vendor/three.module.min.js';
import { createView } from './gl.js';
import { createLean } from './lean.js';

const ROWS = 46;        // ridgelines, front to back
const POINTS = 110;     // points along each ridgeline
const WIDTH = 28;       // plane width, in world units
const NEAR_Z = 5;       // first ridgeline (closest to the camera)
const FAR_Z = -24;      // last ridgeline

export const SIMPLEX_NOISE = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uRise;     // 0 = flat plane, 1 = full terrain (animated in on load)
  uniform vec2 uPointer;   // where the pointer meets the plane (x, z)
  uniform float uHill;     // height of the pointer's hill, 0..1

  varying float vDepth;
  varying float vHill;

  ${SIMPLEX_NOISE}

  void main() {
    vec3 p = position;

    float terrain = snoise(vec3(p.x * 0.15, p.z * 0.15, uTime * 0.05))
                  + snoise(vec3(p.x * 0.42, p.z * 0.42, uTime * 0.09)) * 0.24;

    vec2 offset = p.xz - uPointer;
    float hill = uHill * 2.6 * exp(-dot(offset, offset) / 5.0);

    p.y = (terrain + hill) * uRise;
    vHill = hill;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vDepth = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uPeak;
  uniform float uFadeNear;
  uniform float uFadeFar;

  varying float vDepth;
  varying float vHill;

  void main() {
    float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, vDepth);
    vec3 colour = mix(uColor, uPeak, smoothstep(0.7, 2.2, vHill));
    gl_FragColor = vec4(colour, fade * 0.8);
  }
`;

function buildRidgelines() {
  const segments = ROWS * (POINTS - 1);
  const positions = new Float32Array(segments * 2 * 3);
  let i = 0;

  for (let row = 0; row < ROWS; row++) {
    const z = NEAR_Z + ((FAR_Z - NEAR_Z) * row) / (ROWS - 1);
    for (let point = 0; point < POINTS - 1; point++) {
      const x0 = -WIDTH / 2 + (WIDTH * point) / (POINTS - 1);
      const x1 = -WIDTH / 2 + (WIDTH * (point + 1)) / (POINTS - 1);
      positions.set([x0, 0, z, x1, 0, z], i);
      i += 6;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

export async function mountTerrain(canvas, { gsap, still = false, scroll = { progress: 0 } } = {}) {
  let renderer;
  try {
    renderer = createView(canvas);
  } catch {
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));

  const styles = getComputedStyle(document.documentElement);
  const uniforms = {
    uTime: { value: 0 },
    uRise: { value: still || !gsap ? 1 : 0 },
    uPointer: { value: new Vector2(0, -4) },
    uHill: { value: 0 },
    uColor: { value: new Color(styles.getPropertyValue('--lime').trim() || '#8b7bff') },
    uPeak: { value: new Color(styles.getPropertyValue('--coral').trim() || '#ff6b8b') },
    uFadeNear: { value: 6 },
    uFadeFar: { value: 26 },
  };

  const scene = new Scene();
  scene.add(new LineSegments(
    buildRidgelines(),
    new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false }),
  ));

  const camera = new PerspectiveCamera(42, 1, 0.1, 80);
  const rig = new Group();
  rig.add(camera);
  scene.add(rig);
  camera.position.set(0, 3.4, 9.5);
  const focus = new Vector3(0, 0.2, -4);
  const lookTarget = new Vector3();

  function render(timeMs = 0) {
    uniforms.uTime.value = timeMs / 1000;
    const dive = scroll.progress;
    rig.position.set(0, -dive * 1.6, -dive * 8);
    lookTarget.copy(focus).add(rig.position);
    camera.lookAt(lookTarget);
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
  await renderer.compileAsync(scene, camera).catch(() => {});

  render();
  canvas.classList.add('is-live');
  if (still) return true;

  let onScreen = true;
  let steer = null; // assigned below
  let lastFrame = 0;
  const tick = (time) => {
    if (time - lastFrame < 1 / 32) return;   // ~30 fps is plenty for a decorative scene
    lastFrame = time;
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
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    updateLoop();
  }).observe(canvas);
  document.addEventListener('visibilitychange', updateLoop);
  updateLoop();

  if (!gsap) return true;

  gsap.to(uniforms.uRise, { value: 1, duration: 2.4, ease: 'expo.out', delay: 0.3 });
  gsap.from(camera.position, { y: 8, z: 13, duration: 2.6, ease: 'expo.out', delay: 0.1 });

  const card = canvas.parentElement;
  const raycaster = new Raycaster();
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const hit = new Vector3();
  const ndc = new Vector2();

  const glide = { duration: 0.12, ease: 'power2.out' };
  const pointerX = gsap.quickTo(uniforms.uPointer.value, 'x', glide);
  const pointerZ = gsap.quickTo(uniforms.uPointer.value, 'y', glide);
  const hillTo = gsap.quickTo(uniforms.uHill, 'value', { duration: 0.8, ease: 'power2.out' });
  const swayX = gsap.quickTo(camera.position, 'x', { duration: 1.2, ease: 'power3.out' });

  let rect = null;
  const forget = () => { rect = null; };
  window.addEventListener('scroll', forget, { passive: true });
  window.addEventListener('resize', forget);

  const read = createLean(card);
  steer = (time) => {
    const lean = read(time);
    if (lean.source === 'none') {
      hillTo(0);
      swayX(0);
      return;
    }
    if (lean.source === 'pointer') {
      rect ??= canvas.getBoundingClientRect();
      ndc.set(((lean.clientX - rect.left) / rect.width) * 2 - 1, -((lean.clientY - rect.top) / rect.height) * 2 + 1);
    } else {
      ndc.set(lean.x * 0.8, -0.2 - lean.y * 0.5);
    }
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(ground, hit)) {
      pointerX(hit.x);
      pointerZ(hit.z);
      hillTo(lean.source === 'sway' ? 0.8 : 1);
    }
    swayX(ndc.x * 0.8);
  };

  return true;
}
