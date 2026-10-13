# Townies

A SimCity 2000–style city sim set in the real Watertown, Massachusetts. You're the new City Manager.

**Play:** https://samuelling.github.io/Townies/

## What's real
- **The map, true to scale.** Each tile is 16 m. Streets, building footprints, the Charles, parks, trees and named businesses come from OpenStreetMap (via Geofabrik's daily extract). A GitHub Action (`.github/workflows/refresh-data.yml`) downloads and trims them every other month into `data/watertown.json.gz` (a few MB), so the game opens quickly and works offline. Add `?live=1` to the URL to download straight from the map servers instead.
- **The businesses.** Overture Maps places (names and categories) are merged with OpenStreetMap's, and MassGIS building footprints fill in any buildings OpenStreetMap is missing.
- **The parcels.** Assessed land and building values, use codes, year built, units, stories and the assessor's style ("Two Family", "Decker", "Colonial"…) come from the MassGIS statewide property tax parcels. Owner names are never requested.
- **How buildings look.** Roof form, porches, siding and facade are picked from the assessor style, year, units and any OpenStreetMap colour/roof tags. Two-families get front gables and stacked porches facing the street, deckers get flat roofs with three porches, labs get rooftop mechanicals.
- **The money.** The budget is calibrated to the real tax base. Massachusetts rules apply: Prop 2½ caps levy growth, the commercial shift is capped, overrides go to the voters, and there's a residential exemption.
- **The drama.** Council agenda items riff on recurring local storylines: the Square redesign, the garage behind CVS, the lab glut, the tax-shift cliff, rats, the overnight parking ban, Little Greenough and more. They're fictionalised and paraphrased, and no private individuals are named.

## Controls
Query, pan, bulldoze, road, zone R/C/I (tap again for light/dense), park, police, fire, school, rotate, zoom.
Keys: `Q H B D 1 2 3 4 P` · `, .` rotate · `+ −` zoom · space pause.
On phones: one finger uses the tool, two fingers pan and pinch.

Music is generated live in the browser.

## Credits
Map data © OpenStreetMap contributors (ODbL), via Geofabrik. Parcels and building footprints: MassGIS (Bureau of Geographic Information), Commonwealth of Massachusetts. Business listings: Overture Maps Foundation (CDLA-Permissive-2.0). Inspired by SimCity 2000; not affiliated with Maxis or EA.

No build step: plain ES modules served by GitHub Pages.
