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
