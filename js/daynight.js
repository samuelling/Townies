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

// Twilight, in hours: negative before sunset (or after sunrise), positive after sunset (or before sunrise).
// Real dusk takes a while: civil twilight ends about half an hour after sunset, nautical an hour and a quarter,
// astronomical about two hours, and the colour change starts well before the sun touches the horizon.
export function twilight(hour, month) {
  const r = RISE[month], s = SET[month];
  if (hour >= r && hour <= s) return -Math.min(hour - r, s - hour);
  return Math.min((hour - s + 24) % 24, (r - hour + 24) % 24);
}
// colour the whole scene is multiplied by, through golden hour, sunset, the blue hour and into night
const STOPS = [
  [-1.6, [255, 255, 255]],
  [-0.8, [255, 238, 214]],
  [0, [246, 188, 150]],
  [0.5, [196, 136, 150]],
  [1.1, [116, 96, 142]],
  [1.7, [64, 68, 112]],
  [2.3, [40, 48, 90]],
];
export function skyTint(e) {
  if (e <= STOPS[0][0]) return STOPS[0][1];
  for (let k = 1; k < STOPS.length; k++) {
    const [e1, c1] = STOPS[k];
    if (e <= e1) {
      const [e0, c0] = STOPS[k - 1];
      const t = (e - e0) / (e1 - e0);
      return c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
// street lights come on gradually from a little before sunset until it's properly dark (and off again at dawn)
export const lightsOn = (e) => smooth(-0.35, 1.1, e);
// after about 11 p.m. most people turn in; windows come back on before dawn
export function lateness(hour) {
  const hh = (hour - 22 + 24) % 24;
  return hh < 2 ? hh / 2 : hh < 7 ? 1 : hh < 8.5 ? 1 - (hh - 7) / 1.5 : 0;
}
export function clock(hour) {
  const h = Math.floor(hour) % 24, m = Math.floor((hour % 1) * 60 / 10) * 10;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

// Who's still up. Every lit window belongs to one of these groups; each group's lights go off around its
// bedtime (and early risers' come back on before dawn). By 1 a.m. only the night owls are left, plus porch
// lights, street lamps and signs, which stay on all night. Hours are counted from noon so the night doesn't
// wrap around midnight.
export const BEDTIMES = [
  { share: 0.3, bed: 22.0, wake: 6.0 },
  { share: 0.3, bed: 23.25, wake: 6.5 },
  { share: 0.25, bed: 0.5, wake: 7.0 },
  { share: 0.15, bed: null, wake: null }, // night owls
];
const fromNoon = (h) => (h - 12 + 24) % 24;
// 0..1: how many of a group's lights are on at this hour (a quarter-hour fade, so they click off in a wave)
export function groupOn(k, hour) {
  const g = BEDTIMES[k];
  if (g.bed == null) return 1;
  const hn = fromNoon(hour), bed = fromNoon(g.bed), wake = fromNoon(g.wake);
  if (hn < bed) return 1;
  if (hn < bed + 0.25) return 1 - (hn - bed) / 0.25;
  if (hn < wake) return 0;
  if (hn < wake + 0.25) return (hn - wake) / 0.25;
  return 1;
}
// which group a window is in, from a uniform 0..1 draw
export function groupOf(u) {
  let acc = 0;
  for (let k = 0; k < BEDTIMES.length; k++) { acc += BEDTIMES[k].share; if (u < acc) return k; }
  return BEDTIMES.length - 1;
}
