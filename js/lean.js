/*
 * Where a 3D scene should lean, from whatever input the device has:
 *
 *  1. Mouse over the scene's section (desktop), or a finger touching or
 *     dragging across it (phones; page scrolling is never blocked).
 *  2. Tilting the phone (gyroscope). Android allows this straight away;
 *     iOS asks for permission once, the first time a scene is touched.
 *  3. On touch devices with neither, a slow automatic sway, so the scenes
 *     never sit frozen on a phone.
 *
 * createLean(area) returns read(timeSeconds) -> { x, y, clientX, clientY, source },
 * where x and y run -1..1 (left/top to right/bottom). Scenes call it every frame.
 */

const clamp = (value) => Math.max(-1, Math.min(1, value));
const touchFirst = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// One gyroscope listener, shared by every scene.
let tilt = null;
let tiltListening = false;
function listenForTilt() {
  if (tiltListening) return;
  tiltListening = true;
  window.addEventListener('deviceorientation', (event) => {
    if (event.gamma == null || event.beta == null) return;
    // gamma: left/right roll. beta: front/back, about 45° when a phone is held to read.
    tilt = { x: clamp(event.gamma / 30), y: clamp((event.beta - 45) / 30) };
  }, { passive: true });
}

const askPermission = typeof window.DeviceOrientationEvent?.requestPermission === 'function';
if (touchFirst && 'DeviceOrientationEvent' in window && !askPermission) listenForTilt();

let asked = false;
function askForTilt() {
  // iOS only shows its motion permission prompt in answer to a tap.
  if (!askPermission || asked) return;
  asked = true;
  window.DeviceOrientationEvent.requestPermission()
    .then((state) => { if (state === 'granted') listenForTilt(); })
    .catch(() => {});
}

export function createLean(area) {
  let pointer = null;
  const set = (clientX, clientY) => {
    pointer = {
      x: clamp((clientX / window.innerWidth) * 2 - 1),
      y: clamp((clientY / window.innerHeight) * 2 - 1),
      clientX, clientY,
    };
  };
  const release = () => { pointer = null; };

  area.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') set(event.clientX, event.clientY);
  }, { passive: true });
  area.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') release();
  });

  // Touch events keep arriving while the page scrolls (pointer events stop), and
  // passive listeners never delay or block that scroll.
  const onTouch = (event) => {
    const touch = event.touches[0];
    if (touch) set(touch.clientX, touch.clientY);
  };
  area.addEventListener('touchstart', onTouch, { passive: true });
  area.addEventListener('touchmove', onTouch, { passive: true });
  area.addEventListener('touchend', () => { release(); askForTilt(); }, { passive: true });
  area.addEventListener('touchcancel', release, { passive: true });

  return (time = 0) => {
    if (pointer) return { ...pointer, source: 'pointer' };
    if (tilt) return { x: tilt.x, y: tilt.y, source: 'tilt' };
    if (touchFirst) return { x: Math.sin(time * 0.45) * 0.55, y: Math.cos(time * 0.31) * 0.4, source: 'sway' };
    return { x: 0, y: 0, source: 'none' };
  };
}
