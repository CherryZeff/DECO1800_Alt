# ParkPal

ParkPal helps runners find Brisbane toilets and drinking water, plan walking routes, and share facilities and problem reports. The interface uses plain HTML, CSS and JavaScript with Leaflet. A small Node server saves shared JSON records and photos. There is no build step or application dependency to install.

## Run locally

1. Install Node.js 22 or newer.
2. From this project directory, run `node server.js` (or `npm start`).
3. Open **http://localhost:3000**.

**Use the Node server, rather than Live Server**, for the working app. Live Server cannot write shared JSON or photo files. Root `index.html` remains the entry point; the Node server serves it at `/` and `/index.html`.

Optional environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0), `DATA_DIR` (default this project's `data` directory), and `SECURE_COOKIES=1` when served through HTTPS.

## Pages and code

| File                                                            | Responsibility                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `index.html`                                                    | Home map, facility bottom sheet, three closest toilets, new submissions |
| `public/accounts.html`                                          | Accounts, radius slider, preferences, browser contribution recovery     |
| `public/routes.html`                                            | Route start, ordered stops, walking route and directions                |
| `public/activity.html`                                          | Ten latest shared reports and resolution controls                       |
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

## Shared storage

- `data/accounts.json`: accounts, salted password hashes and preferences.
- `data/submissions.json`: community facilities and references to their photo filenames.
- `data/reports.json`: reports and resolution information.
- `data/photos/`: uploaded JPEG, PNG and WebP files. Up to three photos per submission, each at most 2 MB. Photos appear in facility details.

Existing JSON records are retained. Each facility request loads council results first, then reads submissions fresh from disk and applies the same radius. Reports and resolution changes are written before success is returned to the interface. Community records are available to other browsers without signing in; adding facilities and reporting/resolving problems require an account.

The server only serves allowed application assets and uploaded images. Account JSON and other project files are not public URLs. Back up the whole data directory together. Run a **single Node process** against each data directory; these JSON files are not a multi-process database.

Sessions use HttpOnly cookies, expire after seven days, and are held in server memory: restarting the server requires signing in again but does not remove saved records. There is no email verification, password reset or moderation interface. Contributions appear immediately and remain unverified.

Guest radius is saved in this browser's `localStorage`; signed-in radius is saved with the account. Route drafts and their chosen start remain in `sessionStorage` for the current tab. Facility coordinates are shared; GPS history is not recorded.

## Recover contributions from the earlier browser-only version

Earlier browser accounts are separate from server accounts. Sign in with an existing server account, or create one using the same email as your old browser account.

On the Accounts page, **Import browser contributions** copies that account's old submissions and reports into shared storage. Retrying an import does not duplicate the same records. Old browser storage is retained, and passwords are never exported.

Browser storage belongs to an exact origin, including its port. If old contributions were made through Live Server:

1. Open the updated Accounts page on the **same old Live Server address**, in the browser that still holds the old signed-in account.
2. Choose **Export browser contributions**. The server-unavailable message does not prevent this export.
3. Open ParkPal through Node, sign in with the matching email, and choose that JSON file under **Recover browser contributions**.

If that browser's old account was signed out, sign in using the previous browser-only version before exporting. Contributions for other accounts must be recovered separately. Clearing old browser storage before exporting loses those browser-only records.

## Map and routes

The account page has a **1–10 km radius slider**, in 1 km steps, defaulting to **5 km**. Save it and return to the map to apply it. Toilet amenities, bottle filling and hiding facilities with unresolved reports are optional account preferences.

The circular toilet button in the bottom navigation asks for your location and displays **up to three closest matching toilets within your radius**, ranked by straight-line distance. Other facility markers are hidden. Choose a pin or list item and select **Route here** to draw the walking route. The top-left back button returns to normal exploration; the route page has a back link to the toilet choices. If fewer than three qualify, only those available are shown. If council toilet data cannot load, the app does not claim a reliable nearest selection.

Normal exploration has clustered markers, type filters, name/address search and a tap/swipe bottom sheet. GPS denial leaves a labelled Brisbane preview; users can also choose route starts on the map. Panning does not fetch a new area automatically. Preferences can hide a saved submission if it does not match them.

Routes include up to ten ordered facility or map stops, reordering/removal, and an optional return to start. They show mapped walking paths, distance, estimated walking time and directions. Failed routing shows an error rather than an invented line. This is a route planner, not live navigation or run tracking.

Reports support broken, dirty, unavailable, under construction, missing and other problems. Activity shows the ten latest reports. Facility details show the last ten plus older unresolved reports so those problems can still be marked resolved.

## External services and hosting

Council datasets:

- [Public toilets in Brisbane](https://data.brisbane.qld.gov.au/explore/dataset/public-toilets-in-brisbane/information/)
- [Park drinking fountain / tap locations](https://data.brisbane.qld.gov.au/explore/dataset/park-drinking-fountain-tap-locations/information/)

The server makes radius-filtered council queries, fetches all matching pages and caches successful council responses for five minutes. Community submissions and reports are read fresh on each request. Council water records do not confirm bottle filling; that preference matches explicitly tagged community submissions.

Leaflet, marker clustering and OpenStreetMap tiles load over the internet. Walking routes use FOSSGIS's OSRM foot service. The council receives search coordinates/radius; the route provider receives route coordinates. These public services can be unavailable and have usage limits.

For UQ Zone, deploy this as a **Node application**, not just static files. Preserve the root `index.html` and `public/` structure, configure the Zone to run `node server.js` on its assigned port, and route web requests to that process. Keep `DATA_DIR` on persistent writable storage outside any separately served static directory. Enable HTTPS for phone geolocation and set `SECURE_COOKIES=1` there. Localhost is allowed for development.

See [initialize_server.txt](initialize_server.txt) for researched, step-by-step UQcloud `webproject` setup tailored to ParkPal, including uploads, Node service settings, nginx, photos, backups and troubleshooting. The assigned Zone itself has not been inspected or configured; use your course's allocation and confirm that its image matches the guide. Uploading `index.html` alone will not enable shared storage or photos.

## Checks

Run `npm test` (or `node --test tests/server.test.js`). Backend tests use a temporary data directory and mocked council/routing responses, leaving project records intact. They cover authentication, file access, radius queries, submission reloads, reports, photos, import retries and routes. Browser checks should also cover phone/desktop layout and route-line rendering.
