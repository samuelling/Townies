// The small bridge to the iOS app (ios/). The app shows the game's own Mac OS 9-style interface, exactly
// as on the web; this only adds what a web page can't do there: haptics on the same moments as the sound
// effects, and the iOS share sheet. (Keeping the screen awake at the slow day-and-night speeds is posted
// from ui.js.) On the web, NATIVE is false and none of this runs.
export const NATIVE = typeof window !== 'undefined' && !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.townies);

export function post(type, data = {}) {
  if (!NATIVE) return;
  try { window.webkit.messageHandlers.townies.postMessage(JSON.stringify({ type, ...data })); } catch (e) { /* not in the app */ }
}

export function initNative(ui) {
  if (!NATIVE) return;
  const music = ui.g.music;
  const sfx = music.sfx.bind(music);
  music.sfx = (kind, n) => { post('haptic', { kind }); return sfx(kind, n); };
}

// What goes wrong shows up in Xcode's console (the app prints 'log' messages), and on screen once.
export function nativeLog(msg) { post('log', { msg: String(msg).slice(0, 2000) }); }
let shown = false;
export function reportError(e) {
  const msg = (e && (e.stack || e.message)) || String(e);
  nativeLog('ERROR ' + msg);
  if (shown || typeof document === 'undefined') return;
  shown = true;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#fff8d0;color:#222;border:2px solid #333;font:12px/1.35 Geneva,sans-serif;padding:8px;white-space:pre-wrap;max-height:40vh;overflow:auto';
  d.textContent = 'Something went wrong (tap to hide):\n' + String(msg).slice(0, 800);
  d.onclick = () => d.remove();
  document.body.appendChild(d);
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => reportError(ev.error || ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason));
}
