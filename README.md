# ParkPal

ParkPal helps runners find Brisbane toilets and drinking water plus selected convenience stores in Brisbane, Logan and Ipswich, plan walking routes, and share facilities and problem reports. The interface uses plain HTML, CSS and JavaScript with Leaflet. A small Node server saves shared JSON records and photos. There is no build step or application dependency to install.

## Run locally

1. Install Node.js 22 or newer.
2. From this project directory, run `node server.js` (or `npm start`).
3. Open **http://localhost:3000**.

**Use the Node server, rather than Live Server**, for the working app. Live Server cannot write shared JSON or photo files. Root `index.html` remains the entry point; the Node server serves it at `/` and `/index.html`.

Optional environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0), `DATA_DIR` (default this project's `data` directory), and `SECURE_COOKIES=1` when served through HTTPS. `GEOCODER_URL` can replace the default Nominatim-compatible search endpoint.

## Pages and code

| File                                                            | Responsibility                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `index.html`                                                    | Home map, four map modes, three closest toilets, new submissions |
| `public/accounts.html`                                          | Sign-in, name/email/password editing, browser contribution recovery     |
| `public/routes.html`                                            | Route planner, running estimates and full-screen elapsed timer                |
| `public/activity.html`                                          | Reports for favourites and recently visited facilities                  |
| `public/js/index.js`, `accounts.js`, `routes.js`, `activity.js` | Respective page interactions                                            |
| `public/js/api.js`                                              | Same-origin requests to the Node server                                 |
| `public/js/storage.js`                                          | Accounts, shared submissions/reports, radius preferences                |
| `public/js/services.js`                                         | Facility and walking-route API calls                                    |
| `public/js/map.js`                                              | Leaflet markers, clusters, selection and route lines                    |
| `public/js/facility-details.js`, `reports.js`                   | Facility dialog and report timelines                                    |
| `public/js/photos.js`                                           | Photo selection, previews and upload preparation                        |
| `public/js/migration.js`                                        | Optional recovery of old browser contributions                          |
| `public/js/route-state.js`, `helpers.js`                        | Tab-local route draft and shared utilities                              |
| `public/style.css`, `icon.svg`, `icons.svg`                     | Responsive styling, running-person logo and interface icons             |
| `server.js`                                                     | Static pages, authentication, council/routing requests and file storage |
| `FEATURES.txt`                                                  | Current feature report; update whenever functionality changes           |

More links to **Account**, **Settings**, and **Log out**. Settings contains running speed, radius, ferry-route opt-in, toilet/water preferences and a browser-local light/dark switch. Activity contains three separate pages: `public/history.html` (Past routes), `public/favourites.html` and `public/activity.html` (Facility activity). New page scripts are `more.js`, `settings.js` and the small pre-paint `theme.js`.

## Convenience store import

**Initial snapshot:** `data/stores.json` contains 229 imported stores across the three council areas: 13 EzyMart, 105 7-Eleven, 53 Shell/Coles Express, 21 NightOwl and 37 Foodary. Opening hours are recorded for 71 stores; 158 are explicitly unknown. These counts describe the initial snapshot and can change on refresh. An empty installation shows a message until its first successful import.

Run `npm run import:stores` (or `node scripts/import-stores.js`) to refresh `data/stores.json`. No API key or extra dependency is required. The script queries OpenStreetMap through [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API), using exact council-area names and Queensland boundary verification of Brisbane, Logan and Ipswich. It includes mapped convenience shops and fuel stations for EzyMart, 7-Eleven, Shell/Coles Express, NightOwl and Foodary, matching name, brand or operator. Other Ampol/Caltex stations are not assumed to be Foodary.

Records include stable OSM IDs, name, chain, coordinates, council area, available address/opening hours, attribution and import time. Way/relation coordinates are bounding-box centres; nearby duplicate records of the same chain within 30 metres are merged. Missing hours display **Opening hours not recorded**; mapped hours are shown as supplied, and recognised schedules support the open-now filter. OSM coverage is incomplete and may be outdated; a mapped fuel station does not confirm every convenience-store service. Unmapped branches are not invented.

Only a successful import of all three areas replaces the snapshot. API errors, incomplete responses or empty areas leave the previous file intact. Store requests are read locally during app use; there is no scheduled refresh. Rerun the importer periodically as needed. `DATA_DIR` selects the destination, just as for the server. The importer tries the main Overpass API, Private.coffee, then the global VK Maps mirror sequentially on network/server errors or incomplete responses, with a 60-second limit per attempt. Progress includes the host being queried and its error. Invalid queries (HTTP 400) stop immediately. If every service fails, wait and rerun the same command; no npm reinstall is needed.

`OVERPASS_URL` selects one specific global Overpass instance and disables automatic fallback, for example:

```sh
OVERPASS_URL=https://overpass-api.de/api/interpreter npm run import:stores
```

For Zone with `DATA_DIR=/var/lib/parkpal`, run from the project directory:

```sh
sudo -u www-data env DATA_DIR=/var/lib/parkpal /usr/bin/node scripts/import-stores.js
```

The next facility refresh sees the new snapshot without restarting. Do not copy your entire local data directory over live account/contribution files. Store data is © [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright); attribution also appears on the map and in store details.

## Shared storage

- `data/accounts.json`: accounts, salted password hashes and preferences.
- `data/submissions.json`: community facilities and references to their photo filenames.
- `data/reports.json`: reports and resolution information.
- `data/routes.json`: routes generated while signed in, including start, ordered stops and creation time; scoped to their account.
- `data/favourites.json`: each account's saved facilities.
- `data/visits.json`: each account's facility visits, recorded manually or when included as route stops.
- `data/stores.json`: imported OpenStreetMap store snapshot (not community submissions).
- `data/photos/`: uploaded JPEG, PNG and WebP files. Up to three photos per submission, each at most 2 MB. Photos appear in facility details.

Saved routes store only the route ID, user ID, creation date and a draft containing the original start coordinates/label, ordered stop coordinates/names (and facility IDs where applicable), and return-to-start setting. `routes.json` uses readable indented JSON. Calculated geometry, directions, distance and duration are not saved. Reuse loads the original points into the planner without changing the start to your current location, requesting directions, recording visits or saving another entry. Tap **Preview route** to calculate a fresh walking path; successful creation saves a new plan and records facility visits as usual. The new path may differ if map data has changed.

On startup, existing routes are converted to this smaller format if needed. Before rewriting, the server keeps the exact original in a private `routes.backup-<id>.json` beside `routes.json`. These migration backups are not loaded by the app and are excluded from Git; they still occupy disk space until you archive or remove them after checking your saved routes. This is not a replacement for regular backups.

Existing JSON records are retained. Each facility request loads council results first, then reads submissions and imported stores fresh from disk and applies the same radius. Reports and resolution changes are written before success is returned to the interface. Community records are available to other browsers without signing in; adding facilities and reporting/resolving problems require an account.

The server only serves allowed application assets and uploaded images. Account JSON and other project files are not public URLs. Back up the whole data directory together. Run a **single Node process** against each data directory; these JSON files are not a multi-process database.

Sessions use HttpOnly cookies, expire after seven days, and are held in server memory: restarting the server requires signing in again but does not remove saved records. There is no email verification, password reset or moderation interface. Contributions appear immediately and remain unverified.

Guest running speed, radius and facility preferences are saved in this browser's `localStorage`; signed-in preferences are saved with the account. Theme is browser-local. Route drafts remain in `sessionStorage`, and successfully generated routes are also saved privately for signed-in users. Saved routes include their start and stop coordinates; no continuous GPS tracking is performed. Visits are self-reported or inferred from planned route stops, not verified arrival. Profile edits require the current password; changing email or password invalidates other sessions.

## Recover contributions from the earlier browser-only version

Earlier browser accounts are separate from server accounts. Sign in with an existing server account, or create one using the same email as your old browser account.

On the Accounts page, **Import browser contributions** copies that account's old submissions and reports into shared storage. Retrying an import does not duplicate the same records. Old browser storage is retained, and passwords are never exported.

Browser storage belongs to an exact origin, including its port. If old contributions were made through Live Server:

1. Open the updated Accounts page on the **same old Live Server address**, in the browser that still holds the old signed-in account.
2. Choose **Export browser contributions**. The server-unavailable message does not prevent this export.
3. Open ParkPal through Node, sign in with the matching email, and choose that JSON file under **Recover browser contributions**.

If that browser's old account was signed out, sign in using the previous browser-only version before exporting. Contributions for other accounts must be recovered separately. Clearing old browser storage before exporting loses those browser-only records.

## Map and routes

More → Settings has a **1–10 km radius slider**, in 1 km steps, defaulting to **5 km**. Save it and return to the map to apply it. Toilet amenities, bottle filling and hiding facilities with unresolved reports are optional facility preferences.

The circular quick-search button asks for your location and checks matching facilities within your radius in straight-line distance order. If a facility has no valid pedestrian path, it tries the next candidate until **three reachable choices** are found or the candidates run out. Other facility markers are hidden. Tap a pin or estimate bubble to open that facility's route and **automatically start the full-screen run and timer** once the route is revalidated. A failed route does not start the run or save a plan. The top-left back button returns to exploration; the route page links back to the facility choices. General service/network failures stop the search with a retry message.

The compact black home header contains the running logo and search. Search finds suburbs, named places and imported store names/addresses across the Brisbane region (including Logan and Ipswich). Choosing a store recentres the map and opens its details. Local store matches remain available if geocoding fails. Vertical rectangular side buttons show the destination facility icon above a < or > symbol and cycle **All → Toilets → Water fountains → Convenience stores** in either direction; each button's colour shows its destination mode. The top-left map pill displays the current mode, aligned with the top-right controls. Tap pins for facility details. Stores are pink; community pins retain their type colour with a black dotted outline. The orange **+ Add** button sits left of Locate. Map zoom buttons appear above 768px only; touch users can pinch to zoom. The former bottom sheet and separate name filter are removed. GPS denial leaves a labelled Brisbane preview. Panning alone does not reload the radius; location/search/refresh do. Toilet and water amenity preferences do not hide stores, although the hide-problems preference applies to every type.

Routes include up to ten ordered facility or map stops, reordering/removal, and an optional return to start. The simplified planner shows the mapped pedestrian path and distance. **Preview route** calculates an estimated running time using your Settings speed (6–20 km/h, in 0.5 km/h steps, default 10). **Start run** fills the browser viewport with the map, an elapsed timer, your configured running speed, and large **Locate me** / **End route** controls. The speed is a planning setting, not a GPS measurement. Locate me adds your current position without changing the saved start or stops. End route returns to the planner and displays elapsed time. The server requests walking-route alternatives and checks every returned step. Ferries are excluded by default. **Settings → Route preferences → Allow ferries** permits pedestrian/ferry routes in the planner and quick searches; driving, train, bus, unknown modes and reported motorway/restricted classes remain excluded. The setting persists with the account, or in browser storage for guests. If no acceptable alternative is returned, it shows an error and saves nothing. It does not remove unsafe pieces and join the remaining line. With ferries disabled, this provider cannot guarantee a ferry-free alternative; roads with pedestrian access and crossings may be included, and OSM access data can be incomplete. Follow local signs. Failed routing shows an error rather than an invented line. The timer uses elapsed wall-clock time so it catches up after the tab is backgrounded. Reloading or closing the page resets it; durations and GPS tracks are not saved. There is no turn-by-turn navigation, continuous location tracking or automatic rerouting. The full-screen view fills the browser viewport rather than requiring the device Fullscreen API.

Each reachable facility has an orange dotted pedestrian path and a selectable bubble showing path distance and estimated time at your configured running speed for pedestrian segments. Ferry routes are labelled and use the provider's crossing duration, excluding waiting time; missing duration displays an unknown estimate. Results appear as paths are confirmed. Failed paths are skipped, never drawn as straight lines. Comparison requests do not save routes or record visits; selecting a facility generates the usual saved plan for signed-in users. Leaving quick-search mode cancels further candidate checks and clears the previews. Choices are ordered by straight-line distance, not a ranking of all facilities by routed distance.

Council toilet details display the `shower`, `male`, `female`, `unisex` and `allgender` fields. Gender-neutral uses the Council's all-gender flag, separately from unisex. Multiple types can appear together. Missing shower information is shown as “Not recorded”, not “No”; community records without these fields remain unknown. New toilet contributions let users choose Male, Female, Unisex and/or Gender-neutral, plus Yes/No/Not sure for showers. These fields are stored in `submissions.json` under `toiletDetails` and displayed after reload. Unisex also synchronises the existing amenity filter. Water contributions hide and disable these fields.

Reports support broken, dirty, unavailable, under construction, missing and other problems. Facility activity shows the ten latest reports for the signed-in user’s favourites and 20 most recent facilities marked visited or used as route stops; filters can show either group. Past routes lists saved dates and stops and loads their points for reuse; these are not recorded completed runs. Favourite places link back to facility details, where users can favourite/unfavourite and mark a visit. Facility details show the last ten plus older unresolved reports so those problems can still be marked resolved.

## External services and hosting

Council datasets:

- [Public toilets in Brisbane](https://data.brisbane.qld.gov.au/explore/dataset/public-toilets-in-brisbane/information/)
- [Park drinking fountain / tap locations](https://data.brisbane.qld.gov.au/explore/dataset/park-drinking-fountain-tap-locations/information/)

The server makes radius-filtered council queries, fetches all matching pages and caches successful council responses for five minutes. Community submissions and reports are read fresh on each request. Council water records do not confirm bottle filling; that preference matches explicitly tagged community submissions.

Leaflet, marker clustering and OpenStreetMap tiles load over the internet. Walking routes use FOSSGIS's OSRM foot service. The council receives search coordinates/radius; the route provider receives route coordinates. These public services can be unavailable and have usage limits.

Place search uses [Nominatim](https://nominatim.org/release-docs/latest/api/Search/). Queries are sent only on explicit submission, bounded to the Brisbane region, with no autocomplete. The server queues requests at least 1.1 seconds apart and caches up to 100 searches for 24 hours in memory. The geocoder receives the search text. Keep attribution visible and follow the [public endpoint’s usage policy](https://operations.osmfoundation.org/policies/nominatim/); configure `GEOCODER_URL` for another compatible provider if usage grows.

Routing uses the [FOSSGIS foot profile](https://github.com/fossgis-routing-server/cbf-routing-profiles/blob/master/foot.lua) plus ParkPal’s returned-mode validation. It does not switch to car, bus or train routing when a route fails. The foot profile can include ferry crossings when Allow ferries is enabled. This provider does not offer bus/train itineraries or ferry timetables; check services before departure. Reusing saved points applies the current preference.

For UQ Zone, deploy this as a **Node application**, not just static files. Preserve the root `index.html` and `public/` structure, configure the Zone to run `node server.js` on its assigned port, and route web requests to that process. Keep `DATA_DIR` on persistent writable storage outside any separately served static directory. Enable HTTPS for phone geolocation and set `SECURE_COOKIES=1` there. Localhost is allowed for development.

See [initialize_server.txt](initialize_server.txt) for researched, step-by-step UQcloud `webproject` setup tailored to ParkPal, including uploads, Node service settings, nginx, photos, backups and troubleshooting. The assigned Zone itself has not been inspected or configured; use your course's allocation and confirm that its image matches the guide. Uploading `index.html` alone will not enable shared storage or photos.

## Checks

Run `npm test` (or `node --test tests/server.test.js`). Backend tests use a temporary data directory and mocked council/routing responses, leaving project records intact. They cover authentication, file access, radius queries, submission reloads, reports, photos, import retries, search caching, route-mode rejection, account editing, saved routes, favourites, visits, account isolation, Council shower/gender flags, running-speed validation and preview requests that leave routes/visits unchanged. Browser checks should also cover phone/desktop layout and route-line rendering.


Community contributions also accept **Convenience store**. Choose a map pin or current location, enter its name, and optionally add wheelchair accessibility, opening hours, a description and photos. Toilet-specific fields are hidden. These records are saved in `submissions.json`, appear as pink pins with black dotted outlines, and are included in store-name search. They are independent of the imported snapshot and may include other convenience-store chains or independent shops.


## Quick search, opening hours and facility phrases

Hold the bottom navigation shortcut for **5 seconds** to cycle **Toilets → Water → Stores → Toilets**. It animates when the type changes; releasing a long hold does not start a search. The choice persists in this browser across pages. Keyboard users can hold Space or Enter. A tap finds up to three reachable candidates within your saved radius, with route bubbles and automatic start when one is selected.

**More → Settings → Quick search → Only find facilities open now** defaults on, including for existing accounts. Disable it to include closed or unknown-hour facilities. Known schedules are evaluated in Brisbane time (UTC+10), including 24/7, daily times, weekday ranges, multiple intervals and overnight hours. Missing, unclear, seasonal, sunrise/sunset and holiday-dependent schedules are unknown. This checks recorded schedules; it cannot confirm temporary closures or real-world access.

The search bar recognises phrases such as **male toilets**, **female toilets**, **unisex toilets**, **accessible toilets**, **dog fountains**, **bottle fountains**, and **open toilets**. These search known attributes near GPS using your saved radius and existing preferences. Only an explicit “open” phrase applies the opening-hour filter to these searches; the setting above applies to the quick-search button. Other text still searches suburbs, names and stores. Council dog amenities are recognised only when the equipment description explicitly names a dog bowl/bubbler/fountain. Unknown attributes do not qualify.

## Route weather and layout

The map’s top-left badge shows today's Brisbane weather symbol and **forecast maximum temperature**, not a live observation. The backend requests the [BOM ACCESS-G model through Open-Meteo](https://open-meteo.com/en/docs/bom-api); if that model is unavailable or missing today's values, it uses Open-Meteo's general forecast and labels the source accordingly. Neither is the official BOM city forecast. Attribution is provided beside the planner and in the badge's accessible text. Data is cached for 30 minutes, validated against the Brisbane calendar date, and refreshed on return to the page/every five minutes. Failure displays an unavailable state. Weather requires outbound HTTPS to api.open-meteo.com; the public endpoint is for non-commercial use.

Manual map points now use purple numbered markers. Start coordinates remain hidden until **Select start** is used (or a map-selected saved start is restored); **Use my location** hides the card again. **Map stops** and **Find facilities** appear directly below **Your stops**.

## Report photos and resolution proof

Reports can include up to three photos. Resolving a report requires at least one proof photo, enforced by the server as well as the form. JPEG, PNG and WebP are supported, up to 2 MB each. Photos are stored in `data/photos/`; `reports.json` contains original photo references and an append-only resolve/reopen history with proof filenames, times and authors. Account holders can choose **Not resolved — reopen report** on a resolved report. Original photos and previous proof remain visible in its history. This works in both facility details and Activity. Old reports remain readable; existing resolutions are not rewritten. Proof is community-submitted, not independently verified.

Restart `node server.js` after updating the app. No new package installation or data migration is needed. Keep `lib/` with the application when deploying; back up all existing JSON files and `data/photos/` together.
