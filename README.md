# Townies

An isometric city sim set in the real Watertown, Massachusetts. You're the new City Manager.

**Play:** https://samuelling.github.io/Townies/

## What's real
- **The map, true to scale.** Each tile is 16 m. Streets, building footprints, the Charles, parks, trees and named businesses come from OpenStreetMap (via Geofabrik's daily extract). A GitHub Action (`.github/workflows/refresh-data.yml`) downloads and trims them every other month into `data/watertown.json.gz` (a few MB), so the game opens quickly and works offline. Add `?live=1` to the URL to download straight from the map servers instead.
- **The businesses.** Overture Maps places (names and categories) are merged with OpenStreetMap's, and MassGIS building footprints fill in any buildings OpenStreetMap is missing.
- **The parcels.** Assessed land and building values, use codes, year built, units, stories and the assessor's style ("Two Family", "Decker", "Colonial"…) come from the MassGIS statewide property tax parcels. Owner names are never requested.
- **The buildings' looks.** The town assessor's building records (via Vision Government Solutions) add each building's wall material, roof shape and covering, fireplaces and porches, and a siding colour read from the assessor's street photo. `tools/assessor/` fetches them slowly (`fetch.py`, about half an hour) and builds `data/assessor.json.gz` (`build.py`). Only building facts are kept: no owners, sales, values or photos.
- **Roof heights and ridges.** The 2021 USGS lidar survey of eastern Massachusetts (public domain, read from the AWS open data copy) measures each building's eaves and ridge and which way the ridge runs. `tools/lidar/fetch.py` downloads the building and ground returns for the map (about 3,000 tiles, a few minutes) and `tools/lidar/fit.py` fits a roof to every footprint into `data/lidar.json.gz`. Where the assessor names the roof type it wins; checked against the assessor's photos, it was the more reliable of the two.
- **Trees.** Every tree in town stands where it really does. `tools/lidar/fetch.py` with `LIDAR_SET=veg` downloads the vegetation returns, and `tools/trees/fit.py` finds each crown in a canopy height model (its height and spread), then names the street and park trees from Watertown Forestry's 2022 inventory (`tools/trees/inventory.py`) and adds the young ones the lidar can't resolve, sized from their trunks. Private-yard trees have no species; they're drawn as evergreen when the leaf-off spring survey barely got through the crown. The game turns them through the seasons by genus: cherries and pears blossom in April, maples go red in October, oaks brown.
- **Backyards.** The assessor's cards list each parcel's detached garages, sheds, carports and pools with their sizes. Most outbuildings already have a footprint on the map, and they're now drawn as garages and sheds rather than tiny houses. Where a card lists one the map lacks, `tools/yards/structures.py` looks for an unmapped roof of about that size on the lot in the 2021 lidar (alone, those finds are too often bits of houses to trust).
- **Buses.** `tools/transit/gtfs.py` cuts the MBTA's GTFS feed to the map: every route's path, stops and a weekday, Saturday and Sunday timetable, plus each stop's Fall 2025 weekday boardings by route (`tools/transit/ridership.py`). At the Real time speed (the clock on the wall; the city itself barely moves) every bus is where today's schedule puts it; at other speeds the timetable sets how many are out; each route's ridership starts at its measured boardings at Watertown stops.
- **Ground.** `tools/ground/fetch.py` downloads the state's spring 2025 aerial photos (colour and infrared) over the map and `tools/ground/classify.py` sorts every 4 m cell into lawn, pavement, bare ground, water, turf, roof or tree canopy, using the infrared to tell living grass from everything else and the lidar for roofs, into `data/ground.bin.gz`. The game draws driveways, parking lots and pools from it on land that hasn't been rebuilt since.
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
| [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program) lidar, 2021 Central Eastern Massachusetts | Roof heights, ridge directions, flat vs pitched; tree heights and crowns | Public domain (US Government) |
| [MassGIS](https://www.mass.gov/orgs/massgis-bureau-of-geographic-information) 2025 aerial imagery, colour and colour-infrared | Ground cover: driveways, parking lots, lawns, courts, pools | Commonwealth of Massachusetts, MassGIS |
| [MBTA GTFS](https://www.mbta.com/developers/gtfs) and [bus ridership by stop](https://mbta-massdot.opendata.arcgis.com/) | Bus routes, stops, weekday/Saturday/Sunday timetables; Fall 2025 weekday boardings | Massachusetts Bay Transportation Authority |
| [Town of Watertown Forestry](https://watertownma.mapgeo.io/) 2022 tree inventory, via MapGeo | Street and park trees' species, trunk size, condition | Public records of the Town of Watertown |
| [Town of Watertown Assessor](https://gis.vgsi.com/WatertownMA/) building records, via Vision Government Solutions | Wall and roof materials, roof shapes, fireplaces, porches; siding colours read from the street photos | Public records of the Town of Watertown |
| [MassDOT Road Inventory](https://geo-massdot.opendata.arcgis.com/) | Traffic counts (AADT), lanes | Massachusetts Department of Transportation |
| [US Census Bureau LEHD LODES](https://lehd.ces.census.gov/data/) | Commute flows in and out of town | Public domain |
| [Overture Maps](https://docs.overturemaps.org/attribution/) places | Business names and categories | © Overture Maps Foundation, [CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/) |

Walkability is a Walk Score–style index rebuilt from the open data above using Walk Score's published method. It is not Walk Score's own data.

No build step: plain ES modules served by GitHub Pages.
