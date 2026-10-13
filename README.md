# ParkPal

ParkPal helps runners find Brisbane drinking fountains and public toilets, plan walking routes with stops, and record facility problems. It uses **plain HTML, CSS and JavaScript** with Leaflet. There is no build step.

## Open with Live Server

1. Open this project in VS Code or VSCodium.
2. Right-click **`index.html`** and choose **Open with Live Server**.
3. Keep Live Server running while you work. No Node process or `npm install` is needed.

Live Server serves the files over HTTP. Opening the HTML directly as a `file://` URL will not work correctly with JavaScript modules and browser security rules.

## Pages

| File                   | What it does                                                                |
| ---------------------- | --------------------------------------------------------------------------- |
| `index.html`           | Home map, closest-toilet shortcut, bottom sheet of facilities, and new pins |
| `public/routes.html`   | Route start, ordered stops, return trip and walking directions              |
| `public/activity.html` | The 10 latest local reports, with resolution controls                       |
| `public/accounts.html` | Local account creation, sign-in, and facility preferences                   |

Each page has real links to the other pages. Route drafts survive navigation within the same browser tab. The shared bottom navigation provides account access; there is no extra account button at the top.

## Where to edit the code

The files use normal indentation and short comments. Each script has a specific job:

| File                            | Responsibility                                                         |
| ------------------------------- | ---------------------------------------------------------------------- |
| `public/style.css`              | Shared colours, typography, map, bottom sheet, forms and phone layouts |
| `public/icon.svg`               | ParkPal's running-person logo                                          |
| `public/icons.svg`              | Reusable interface symbols                                             |
| `public/js/index.js`            | Home page controls, filters, bottom sheet and adding facilities        |
| `public/js/routes.js`           | Route page interactions and route results                              |
| `public/js/accounts.js`         | Account forms and preferences                                          |
| `public/js/activity.js`         | Activity page interactions                                             |
| `public/js/map.js`              | Leaflet tiles, markers, clusters and route lines                       |
| `public/js/services.js`         | Council dataset and walking-route requests                             |
| `public/js/storage.js`          | Browser-local accounts, contributions and reports                      |
| `public/js/route-state.js`      | Route draft shared between pages in one tab                            |
| `public/js/facility-details.js` | Facility dialog and problem-report form                                |
| `public/js/reports.js`          | Shared report timeline markup                                          |
| `public/js/helpers.js`          | Formatting, location, form handling and other small utilities          |

## Storage: browser-only for now

This version uses `localStorage`, with keys beginning `parkpal.`. Accounts, preferences, submissions and reports stay in the browser and on the exact origin where you created them. A different browser, port, hostname, or device has different data. Clearing browser storage removes the local records.

Accounts are **prototype accounts, not secure server authentication**. Passwords are hashed using Web Crypto rather than saved as plain text, but the browser user can still inspect or change local data. Use demo passwords. Browser-local accounts cannot enforce permissions between real users.

Only a signed-in local account can use the contribution/report controls. Exploring the map and planning routes work without an account. There is no email verification or password recovery.

The existing `data/accounts.json`, `data/submissions.json`, and `data/reports.json` have been left intact. **The static app does not read or modify those files.** Earlier server accounts will not automatically become browser accounts; create a local account for this version.

Browser JavaScript cannot silently write to project files. Sharing contributions between runners or automatically updating JSON files on the host would need a backend or external storage service again.

Route drafts, including the chosen start, use `sessionStorage` so they survive navigation in the current tab. GPS positions are not added to account records. Submitted facility coordinates are saved as part of the submission.

## Map and routes

- Facilities start within **5 km** of the current location, with 2 km and 10 km options in the expanded sheet.
- If GPS is blocked, the app clearly labels the Brisbane preview. You can choose a route start on the map.
- Tap or swipe the sheet handle to show/hide the list. Expanded content scrolls independently of the map. Nearby markers are clustered to keep dense areas readable.
- The closest-toilet shortcut finds the nearest matching toilet by **straight-line distance**, then opens a walking route to it. It does not compare walking distances to every toilet or verify live opening status.
- Routes can have up to 10 stops, visited in the order shown. Stops can be facilities or map pins, and can be moved earlier or removed. A return-to-start option is included.
- Routes follow mapped walking paths. A service failure shows an error; no invented route is substituted. This is a route planner, not live navigation or run tracking.
- Reports support broken, dirty, unavailable, construction, missing and other problems. Facility details show the last 10 reports plus older unresolved reports, so old issues remain resolvable.

The interface uses mostly 16px text, 14px supporting labels, high-contrast controls and large touch targets. The map provider's attribution is the small-text exception.

## External data

Council facilities come from:

- [Public toilets in Brisbane](https://data.brisbane.qld.gov.au/explore/dataset/public-toilets-in-brisbane/information/)
- [Park drinking fountain / tap locations](https://data.brisbane.qld.gov.au/explore/dataset/park-drinking-fountain-tap-locations/information/)

The browser applies `within_distance` queries to the council API and fetches every matching page of 100 records. Successful queries are cached in memory for five minutes. Local submissions use the same distance filter. Panning does not silently fetch another area; using GPS or changing the radius refreshes the home query.

Council water records don't confirm bottle filling. That preference matches only local contributions explicitly tagged with the amenity. Opening hours and other council details are shown as supplied.

Maps use [Leaflet](https://leafletjs.com/), its [marker-clustering plugin](https://github.com/Leaflet/Leaflet.markercluster), and [OpenStreetMap tiles](https://www.openstreetmap.org/copyright). Routes use the [FOSSGIS OSRM walking service](https://routing.openstreetmap.de/about.html). Requests from the route page are spaced at least 1.1 seconds apart. Public services require internet access, allow browser cross-origin requests at present, and have usage limits; use a suitable hosted provider before scaling beyond a class prototype.

The council receives the search coordinates and radius. The route provider receives the route coordinates. Map tiles and Leaflet assets also load over the internet.

## UQ Zone hosting

For a static deployment, upload **the root `index.html` and the entire `public/` folder**, preserving that structure. Links work at the site root or in a subdirectory. Do not upload the project `data/` folder with account records.

The [UQcloud Zone guide](https://stluc.manta.uqcloud.net/xlex/public/zones-guide.html) says a standard `webproject` Zone serves static files from `/var/www/htdocs`. In that setup, `index.html` becomes `/var/www/htdocs/index.html` and the `public/` folder becomes `/var/www/htdocs/public/`. Your allocated Zone's configuration and course instructions may differ; its setup has not been verified here.

The same guide also documents Node hosting for `webproject` Zones, but **this version does not need it**. HTTPS is required for phone geolocation and Web Crypto account setup; localhost is allowed for development. Use the Zone's HTTPS URL when testing on a phone.

## Earlier Node server

`server.js`, `package.json`, and `tests/server.test.js` are retained as the earlier JSON-backend implementation, formatted for readability. They are optional reference code, not dependencies of the current interface. The current pages use browser storage even when served through this server. Do not expect signing in on these pages to call the legacy account APIs.

If desired, `node server.js` still serves the pages at `http://localhost:3000` (Node 22+). `node --test tests/server.test.js` checks the retained backend against mocked external services. Those tests do not verify the static interface; the interface must be tested in a browser.
