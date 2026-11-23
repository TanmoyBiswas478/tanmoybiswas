// Appreciate burst: a small particle globe forms over the heart, then bursts
// outward with a shockwave ring and fades. One reusable canvas, drawn only
// while the effect plays (about 1.5 s).
import {
  Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points,
  ShaderMaterial, Color, AdditiveBlending, IcosahedronGeometry, EdgesGeometry,
  LineSegments, LineBasicMaterial, RingGeometry, Mesh, MeshBasicMaterial,
} from './vendor/three.module.min.js';
import { createView } from './gl.js';

const SIZE = 560;          // canvas size in CSS pixels
const DURATION = 1500;     // ms
const GATHER = 0.14;       // share of the timeline spent forming the globe
const COUNT = 900;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute vec3 aHome;
  attribute vec3 aDir;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aMix;
  attribute float aSpark;
  varying float vAlpha;
  varying float vMix;
  varying float vSpark;

  vec3 spin(vec3 p, float a) {
    float c = cos(a), s = sin(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }

  void main() {
    float g = clamp(uTime / ${GATHER.toFixed(2)}, 0.0, 1.0);
    float b = clamp((uTime - ${GATHER.toFixed(2)}) / ${(1 - GATHER).toFixed(2)}, 0.0, 1.0);
    float spread = 1.0 - pow(1.0 - b, 3.0);

    vec3 home = spin(aHome * mix(0.55, 1.0, g), uTime * 4.0);
    vec3 p = home + aDir * aSpeed * spread;
    p.y -= 0.55 * b * b;                  // a little weight as it settles
    p = spin(p, b * 0.6);                 // slight swirl

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * mix(1.0, 0.35, b) * (6.0 / -mv.z);

    vAlpha = smoothstep(0.0, 0.6, g) * pow(1.0 - b, 1.6);
    vMix = aMix;
    vSpark = aSpark;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uViolet;
  uniform vec3 uCoral;
  varying float vAlpha;
  varying float vMix;
  varying float vSpark;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    vec3 color = mix(mix(uViolet, uCoral, vMix), vec3(1.0), vSpark);
    gl_FragColor = vec4(color, smoothstep(0.5, 0.0, d) * vAlpha);
  }
`;

let stage = null;

function build() {
  const canvas = document.createElement('canvas');
  canvas.className = 'burst';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);

  const renderer = createView(canvas);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.z = 6;

  const styles = getComputedStyle(document.documentElement);
  const violet = new Color(styles.getPropertyValue('--lime').trim() || '#8b7bff');
  const coral = new Color(styles.getPropertyValue('--coral').trim() || '#ff6b8b');

  // Particles: a Fibonacci sphere (the globe), with some filling the inside.
  const home = new Float32Array(COUNT * 3);
  const dir = new Float32Array(COUNT * 3);
  const speed = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);
  const mixAttr = new Float32Array(COUNT);
  const spark = new Float32Array(COUNT);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < COUNT; i += 1) {
    const y = 1 - (i / (COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const radius = Math.random() < 0.72 ? 0.34 : 0.34 * Math.cbrt(Math.random());
    home.set([x * radius, y * radius, z * radius], i * 3);

    const jitter = 0.35;
    const dx = x + (Math.random() - 0.5) * jitter;
    const dy = y + (Math.random() - 0.5) * jitter;
    const dz = z + (Math.random() - 0.5) * jitter;
    const len = Math.hypot(dx, dy, dz) || 1;
    dir.set([dx / len, dy / len, dz / len], i * 3);

    speed[i] = 0.7 + Math.random() ** 1.6 * 0.95;   // keeps every particle inside the canvas
    size[i] = 2.2 + Math.random() * 3.4;
    mixAttr[i] = (x + y + 2) / 4 + (Math.random() - 0.5) * 0.25;
    spark[i] = Math.random() < 0.1 ? 0.85 : 0;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(home, 3));
  geometry.setAttribute('aHome', new BufferAttribute(home, 3));
  geometry.setAttribute('aDir', new BufferAttribute(dir, 3));
  geometry.setAttribute('aSpeed', new BufferAttribute(speed, 1));
  geometry.setAttribute('aSize', new BufferAttribute(size, 1));
  geometry.setAttribute('aMix', new BufferAttribute(mixAttr, 1));
  geometry.setAttribute('aSpark', new BufferAttribute(spark, 1));

  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uViolet: { value: violet },
    uCoral: { value: coral },
  };
  const points = new Points(geometry, new ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  }));
  points.frustumCulled = false;
  scene.add(points);

  // The globe's lattice, visible while it forms, then thrown outward.
  const lattice = new LineSegments(
    new EdgesGeometry(new IcosahedronGeometry(0.36, 1)),
    new LineBasicMaterial({ color: violet, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
  );
  scene.add(lattice);

  // Two thin shockwave rings, coral then violet.
  const ring = (color) => {
    const mesh = new Mesh(
      new RingGeometry(0.985, 1, 96),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
    );
    scene.add(mesh);
    return mesh;
  };
  const rings = [ring(coral), ring(violet)];

  return { canvas, renderer, scene, camera, uniforms, lattice, rings, frame: 0 };
}

const easeOut = (t) => 1 - (1 - t) ** 3;

/** Play the burst centred on (x, y) in viewport pixels. Returns false if WebGL is unavailable. */
export function playBurst(x, y) {
  try {
    stage ??= build();
  } catch {
    return false;
  }
  const s = stage;
  s.canvas.style.left = `${Math.round(x - SIZE / 2)}px`;
  s.canvas.style.top = `${Math.round(y - SIZE / 2)}px`;
  s.canvas.classList.add('is-on');
  cancelAnimationFrame(s.frame);

  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / DURATION, 1);
    s.uniforms.uTime.value = t;

    const g = Math.min(t / GATHER, 1);
    const b = Math.max((t - GATHER) / (1 - GATHER), 0);

    s.lattice.rotation.set(t * 1.2, t * 4, 0);
    s.lattice.scale.setScalar((0.55 + 0.45 * g) * (1 + easeOut(Math.min(b * 3, 1)) * 1.4));
    s.lattice.material.opacity = 0.7 * g * (1 - Math.min(b * 3, 1));

    s.rings.forEach((mesh, i) => {
      const r = Math.max(b - i * 0.06, 0);
      mesh.scale.setScalar(0.3 + easeOut(Math.min(r * 1.6, 1)) * 1.5);
      mesh.material.opacity = r > 0 ? 0.65 * (1 - Math.min(r * 1.6, 1)) : 0;
    });

    s.renderer.render(s.scene, s.camera);
    if (t < 1) {
      s.frame = requestAnimationFrame(step);
    } else {
      s.renderer.clear();
      s.canvas.classList.remove('is-on');
    }
  };
  s.frame = requestAnimationFrame(step);
  return true;
}
