const clamp = (value) => Math.max(-1, Math.min(1, value));
const touchFirst = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Device tilt, where the browser gives it freely (Android). iOS only gives it
// after a system permission prompt; a portfolio popping that up on a tap looks
// suspicious, so iOS never asks and gets the gentle automatic sway instead.
let tilt = null;
const needsPermission = typeof window.DeviceOrientationEvent?.requestPermission === 'function';
if (touchFirst && 'DeviceOrientationEvent' in window && !needsPermission) {
  window.addEventListener('deviceorientation', (event) => {
    if (event.gamma == null || event.beta == null) return;
    tilt = { x: clamp(event.gamma / 30), y: clamp((event.beta - 45) / 30) };
  }, { passive: true });
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

  const onTouch = (event) => {
    const touch = event.touches[0];
    if (touch) set(touch.clientX, touch.clientY);
  };
  area.addEventListener('touchstart', onTouch, { passive: true });
  area.addEventListener('touchmove', onTouch, { passive: true });
  area.addEventListener('touchend', release, { passive: true });
  area.addEventListener('touchcancel', release, { passive: true });

  return (time = 0) => {
    if (pointer) return { ...pointer, source: 'pointer' };
    if (tilt) return { x: tilt.x, y: tilt.y, source: 'tilt' };
    if (touchFirst) return { x: Math.sin(time * 0.45) * 0.55, y: Math.cos(time * 0.31) * 0.4, source: 'sway' };
    return { x: 0, y: 0, source: 'none' };
  };
}
