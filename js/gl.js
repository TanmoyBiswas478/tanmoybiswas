// One WebGL context for the whole page.
//
// Every 3D scene draws into this single off-screen renderer, then copies its
// pixels onto its own <canvas> through a cheap 2D drawImage. Browsers cap the
// number of live WebGL contexts (and each one costs GPU memory, a compositor
// layer and its own shader cache), so sharing one keeps scrolling smooth and
// stops older scenes from being dropped when many are on the page.
//
// createView(canvas) returns a small stand-in for THREE.WebGLRenderer with the
// parts the scenes use: setPixelRatio, setSize, render, clear, compileAsync,
// setAnimationLoop. It throws when WebGL is unavailable, like the real one.
import { WebGLRenderer } from './vendor/three.module.min.js';

let shared = null;

function sharedRenderer() {
  if (shared === null) {
    try {
      shared = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
      shared.setPixelRatio(1);                  // views size themselves in device pixels
      shared.debug.checkShaderErrors = false;   // no blocking shader-status queries
      shared.setScissorTest(true);
    } catch {
      shared = false;
    }
  }
  return shared;
}

export function createView(canvas) {
  const gl = sharedRenderer();
  const context = gl && canvas.getContext('2d');
  if (!context) throw new Error('WebGL unavailable');

  let pixelRatio = 1;
  let loop = null;
  let frame = 0;

  const view = {
    domElement: canvas,

    setPixelRatio(ratio) { pixelRatio = ratio; },
    getPixelRatio() { return pixelRatio; },

    setSize(width, height) {
      const w = Math.floor(width * pixelRatio);
      const h = Math.floor(height * pixelRatio);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    },

    render(scene, camera) {
      const { width, height } = canvas;
      if (!width || !height) return;
      const target = gl.domElement;
      if (target.width < width || target.height < height) {
        // Grow only: reallocating the drawing buffer every time a smaller view renders would thrash.
        gl.setSize(Math.max(target.width, width), Math.max(target.height, height), false);
      }
      gl.setViewport(0, 0, width, height);
      gl.setScissor(0, 0, width, height);
      gl.render(scene, camera);
      // WebGL's origin is bottom-left, so the view's pixels sit at the bottom of the buffer.
      context.clearRect(0, 0, width, height);
      context.drawImage(target, 0, target.height - height, width, height, 0, 0, width, height);
    },

    clear() { context.clearRect(0, 0, canvas.width, canvas.height); },

    setClearColor() {},   // the shared renderer always clears to transparent

    compileAsync(scene, camera) { return gl.compileAsync(scene, camera); },

    setAnimationLoop(callback) {
      cancelAnimationFrame(frame);
      loop = callback;
      if (!loop) return;
      const step = (time) => {
        if (!loop) return;
        frame = requestAnimationFrame(step);
        loop(time);
      };
      frame = requestAnimationFrame(step);
    },
  };
  return view;
}
