// Main-street centers used as benchmarks (Watertown's own centers + peer town centers).
export const PEER_CENTERS = [
  { id: 'wt-square', name: 'Watertown Square', town: 'Watertown', lat: 42.3649, lon: -71.1856, home: true },
  { id: 'wt-coolidge', name: 'Coolidge Square', town: 'Watertown', lat: 42.374, lon: -71.1562, home: true },
  { id: 'wt-arsenal', name: 'Arsenal Yards', town: 'Watertown', lat: 42.3633, lon: -71.1611, home: true },
  { id: 'wt-pleasant', name: 'Pleasant St', town: 'Watertown', lat: 42.3643, lon: -71.1968, home: true },
  { id: 'davis', name: 'Davis Square', town: 'Somerville', lat: 42.3967, lon: -71.1222 },
  { id: 'coolidge-corner', name: 'Coolidge Corner', town: 'Brookline', lat: 42.3414, lon: -71.119 },
  { id: 'moody', name: 'Moody Street', town: 'Waltham', lat: 42.3712, lon: -71.237 },
  { id: 'arlington', name: 'Arlington Center', town: 'Arlington', lat: 42.4155, lon: -71.1566 },
  { id: 'belmont', name: 'Belmont Center', town: 'Belmont', lat: 42.3961, lon: -71.1774 },
  { id: 'newton-centre', name: 'Newton Centre', town: 'Newton', lat: 42.3297, lon: -71.1922 },
];
// box covering all centers plus 1.5 miles (Walk Score's outer radius)
export const PEER_BBOX = { s: 42.305, w: -71.27, n: 42.44, e: -71.09 };
export const MIX_RADIUS_M = 600; // storefront mix: ~7-minute walk
