# Townies

An isometric city sim set in the real Watertown, Massachusetts. You're the new City Manager.

**Play:** https://samuelling.github.io/Townies/

## What's real
- **The map, true to scale.** Each tile is 16 m. Streets, building footprints, the Charles, parks, trees and named businesses come from OpenStreetMap (via Geofabrik's daily extract). A GitHub Action (`.github/workflows/refresh-data.yml`) downloads and trims them every other month into `data/watertown.json.gz` (a few MB), so the game opens quickly and works offline. Add `?live=1` to the URL to download straight from the map servers instead.
- **The businesses.** Overture Maps places (names and categories) are merged with OpenStreetMap's, and MassGIS building footprints fill in any buildings OpenStreetMap is missing.
- **The parcels.** Assessed land and building values, use codes, year built, units, stories and the assessor's style ("Two Family", "Decker", "Colonial"…) come from the MassGIS statewide property tax parcels. Owner names are never requested.
- **How buildings look.** Roof form, porches, siding and facade are picked from the assessor style, year, units and any OpenStreetMap colour/roof tags. Two-families get front gables and stacked porches facing the street, deckers get flat roofs with three porches, labs get rooftop mechanicals.
- **The money.** The budget is calibrated to the real tax base. Massachusetts rules apply: Prop 2½ caps levy growth, the commercial shift is capped, overrides go to the voters, and there's a residential exemption.
- **The drama.** Council agenda items riff on recurring local storylines: the Square redesign, the garage behind CVS, the lab glut, the tax-shift cliff, rats, the overnight parking ban, Little Greenough and more. They're fictionalised and paraphrased, and no private individuals are named.

## How accurate is it?
`node tools/validate.mjs` starts the game in 2000, runs it to 2026 several ways (replaying the real buildings, making only the real big decisions, or hands-off), and compares the result with today's real town: homes, jobs, assessed values, storefronts and auto uses. It also hides a fifth of the MassDOT traffic counts and checks how well the model predicts them. The results ship in `data/validation.json` and are explained in-game under Help → Behind the scenes → How accurate is it?, including where the model still misses and what the check says about the game's own thesis.

## Controls
Query, pan, bulldoze, road, zone R/C/I (tap again for light/dense), park, police, fire, school, rotate, zoom.
Keys: `Q H B D 1 2 3 4 P` · `, .` rotate · `+ −` zoom · space pause.
On phones: one finger uses the tool, two fingers pan and pinch.

Music is generated live in the browser.

## iPhone and iPad
`ios/` is a native app that runs the same game offline, full screen, on iPhone and iPad. The game's files are copied into the app when it builds and served to a web view from a tiny server inside the app (`ios/Townies/LocalServer.swift`), so saves, music, sound and the Mac OS 9-style menus and windows are exactly as on the web. The app adds haptics on the same moments as the sound effects, the iOS share sheet for the report card, and keeps the screen awake at the slow, day-and-night speeds. A GitHub Action compile-checks it on every change.

To install it, you need a Mac with Xcode 16 or newer:

1. Open `ios/Townies.xcodeproj`.
2. Click the blue **Townies** project icon, then **Signing & Capabilities**, then **Team**, and pick your team. The bundle ID is `com.samuelling.townies`.
3. Choose an iPhone or iPad in the device menu and press **▶ Run**. For TestFlight, use **Product › Archive**, then **Distribute App**.

`ios/tools/make_icon.py` renders the app icon from `ios/tools/icon.html`: the splash-screen title across a water tile.

## License & credits
Townies is an original, non-commercial art project.

The code, the pixel-art rendering and the generated music are original to this project. The commenters are invented archetypes, and the Council agenda items are fictionalised paraphrases of recurring local storylines; none of them depicts a real person.

Fonts: [Silkscreen](https://github.com/googlefonts/silkscreen) and [VT323](https://github.com/googlefonts/vt323), SIL Open Font License 1.1, bundled in `fonts/`.

Real data, with thanks:

| Source | Used for | License / attribution |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright), via [Geofabrik](https://download.geofabrik.de/) | Streets, buildings, water, parks, businesses | © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/) |
| [MassGIS](https://www.mass.gov/orgs/massgis-bureau-of-geographic-information) property tax parcels and building structures | Parcels, assessed values, year built, missing footprints | Commonwealth of Massachusetts, MassGIS |
| [MassDOT Road Inventory](https://geo-massdot.opendata.arcgis.com/) | Traffic counts (AADT), lanes | Massachusetts Department of Transportation |
| [US Census Bureau LEHD LODES](https://lehd.ces.census.gov/data/) | Commute flows in and out of town | Public domain |
| [Overture Maps](https://docs.overturemaps.org/attribution/) places | Business names and categories | © Overture Maps Foundation, [CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/) |

Walkability is a Walk Score–style index rebuilt from the open data above using Walk Score's published method. It is not Walk Score's own data.

No build step: plain ES modules served by GitHub Pages.
