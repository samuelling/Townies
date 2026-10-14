// Speeds and the time of day. The speed ladder climbs nonlinearly: at the two slowest speeds a day lasts long
// enough to watch the sun go down and the town light up (a nod to the After Dark "City Lights" screensaver); from
// Turtle up, a day would flash by in a second or two, so the town stays in daylight instead of strobing.
import { clamp } from './util.js';

// [name, icon, milliseconds per game month, day/night cycle shown]
export const SPEEDS = [
  ['Pause', '❚❚', Infinity, false],
  ['Snail', '🐌', 30 * 72000, true], // a day takes 72 s: dusk lasts several seconds
  ['Sloth', '🦥', 30 * 12000, true], // a day in 12 s: a time-lapse
  ['Turtle', '🐢', 60000, false],
  ['Llama', '🦙', 14000, false],
  ['Hare', '🐇', 6000, false],
  ['Cheetah', '🐆', 2000, false],
];
export const DEFAULT_SPEED = 4;
// saves from before the ladder had seven rungs stored 0–3 (Pause, Turtle 14 s, Llama 6 s, Cheetah 2 s)
export const OLD_SPEED = [0, 4, 5, 6];
export const cycles = (v) => !!(SPEEDS[v] && SPEEDS[v][3]);

// Approximate sunrise and sunset in Watertown, local clock time (daylight saving included), mid-month.
// From the NOAA solar calculator for 42.37°N, 71.18°W; rounded to the nearest few minutes.
const RISE = [7.17, 6.75, 6.92, 6.17, 5.5, 5.17, 5.42, 5.92, 6.5, 7.08, 6.67, 7.08];
const SET = [16.67, 17.33, 19.0, 19.5, 20.0, 20.42, 20.33, 19.75, 18.83, 18.0, 16.42, 16.22];

// How high the sun is, as a smooth stand-in for its elevation: 1 at solar noon, 0 at sunrise and sunset,
// −1 in the middle of the night.
export function sunHeight(hour, month) {
  const r = RISE[month], s = SET[month];
  if (hour >= r && hour <= s) return Math.sin((Math.PI * (hour - r)) / (s - r));
  const into = (hour - s + 24) % 24;
  return -Math.sin((Math.PI * into) / (24 - s + r));
}

// colour the whole scene is multiplied by: daylight, golden hour, sunset, dusk, night
const STOPS = [
  [0.3, [255, 255, 255]],
  [0.09, [255, 238, 214]],
  [0.0, [246, 186, 148]],
  [-0.05, [176, 122, 150]],
  [-0.12, [84, 78, 128]],
  [-0.22, [40, 48, 90]],
];
export function skyTint(h) {
  if (h >= STOPS[0][0]) return STOPS[0][1];
  for (let k = 1; k < STOPS.length; k++) {
    const [h1, c1] = STOPS[k];
    if (h >= h1) {
      const [h0, c0] = STOPS[k - 1];
      const t = (h - h1) / (h0 - h1);
      return c1.map((v, i) => Math.round(v + (c0[i] - v) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// street lights come on a little before sunset and go off a little after sunrise
export const lightsOn = (h) => smooth(0.05, -0.1, h);
// after about 11 p.m. most people turn in; windows come back on before dawn
export function lateness(hour) {
  const hh = (hour - 22 + 24) % 24;
  return hh < 2 ? hh / 2 : hh < 7 ? 1 : hh < 8.5 ? 1 - (hh - 7) / 1.5 : 0;
}
export function clock(hour) {
  const h = Math.floor(hour) % 24, m = Math.floor((hour % 1) * 60 / 10) * 10;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
