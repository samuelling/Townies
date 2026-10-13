// Runs the traffic assignment off the main thread so the game doesn't stutter while traffic re-routes.
import { assignCore } from './traffic.js';
self.onmessage = (e) => {
  const flow = assignCore(e.data.inp);
  self.postMessage({ id: e.data.id, flow }, [flow.buffer]);
};
