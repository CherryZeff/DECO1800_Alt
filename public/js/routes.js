// Route page: ordered stops, a chosen start, and walking-route results.
import {
  find,
  icon,
  escapeHTML,
  titleCase,
  notify,
  getLocation,
  setupDialogs,
  formatDate,
  routeEstimate,
} from './helpers.js';
import { getFacilities, getWalkingRoute } from './services.js';
import { FacilityMap } from './map.js';
import { readRoute, saveRoute } from './route-state.js';
import { setupFacilityDetails } from './facility-details.js';

import {
  loadAccount,
  getRadius,
  getPastRoutes,
  getRunningSpeed,
} from './storage.js';

const routeQuery = new URLSearchParams(location.search);
const toiletRoute = routeQuery.has('nearest');
const nearestType = ['water', 'store'].includes(routeQuery.get('nearest'))
  ? routeQuery.get('nearest')
  : 'toilet';
let draft = readRoute();
let showStart = draft.originLabel === 'Chosen map start';
let facilities = [];
let pickMode = null;
let requestNumber = 0;
let loadingRoute = false;
let currentRoute = null;
let startedAt = null;
let timerInterval;
let runSession = 0;
let nearbyRequest = 0;
const details = setupFacilityDetails(loadNearby, () => {
  draft = readRoute();
  clearResult();
  renderDraft();
  notify('Stop added to your route.');
});
const facilityMap = new FacilityMap((facility) => {
  if (!pickMode && startedAt === null) details.open(facility);
}, chooseMapPoint);
setupDialogs();

function clearResult() {
  requestNumber++;
  currentRoute = null;
  find('#run-metrics').hidden = true;
  facilityMap.clearRoute();
  find('#route-result').hidden = true;
  find('#route-message').textContent = '';
}

function renderDraft() {
  find('#route-start-detail').hidden = !showStart;
  find('#route-origin').textContent = draft.originLabel;
  find('#route-origin-detail').textContent =
    draft.originLabel === 'Brisbane preview start'
      ? 'Use GPS or choose a start on the map.'
      : `${draft.origin.lat.toFixed(5)}, ${draft.origin.lng.toFixed(5)}`;
  find('#stop-count').textContent = draft.stops.length;
  find('#route-empty').hidden = draft.stops.length > 0;
  find('#round-trip').checked = draft.roundTrip;
  find('#route-stops').innerHTML = draft.stops
    .map(
      (stop, index) => `
    <li><span class="stop-number">${index + 1}</span><span>${escapeHTML(titleCase(stop.name))}</span>
      ${index > 0 ? `<button data-up-stop="${index}" aria-label="Move ${escapeHTML(stop.name)} earlier">↑</button>` : ''}
      <button data-remove-stop="${index}" aria-label="Remove ${escapeHTML(stop.name)}">×</button>
    </li>`,
    )
    .join('');
  facilityMap.showStops(draft.stops);
  saveRoute(draft);
}

async function loadNearby() {
  const current = ++nearbyRequest;
  if (toiletRoute) {
    facilityMap.showFacilities([]);
    return;
  }
  try {
    const result = await getFacilities(draft.origin, getRadius());
    if (current !== nearbyRequest || startedAt !== null) return;
    facilities = result.facilities;
    facilityMap.showFacilities(facilities);
    if (result.warnings.length) notify(result.warnings.join(' '));
  } catch (error) {
    notify(error.message);
  }
}

async function useLocation() {
  find('#route-location').disabled = true;
  try {
    draft.origin = await getLocation();
    draft.originLabel = 'Your location';
    showStart = false;
    clearResult();
    facilityMap.setCenter(draft.origin, getRadius(), draft.originLabel);
    facilityMap.showRadius(!toiletRoute);
    renderDraft();
    loadNearby();
  } finally {
    find('#route-location').disabled = false;
  }
}

function startPicking(mode) {
  if (!facilityMap.map)
    return notify('The map is unavailable. Check your connection.');
  if (mode === 'stop' && draft.stops.length >= 10)
    return notify('A route can include up to 10 stops.');
  pickMode = mode;
  if (mode === 'start') {
    showStart = true;
    renderDraft();
  }
  find('#pick-message').textContent =
    mode === 'start'
      ? 'Tap the map to choose your start.'
      : 'Tap the map to add a route stop.';
  find('#pick-banner').hidden = false;
  facilityMap.setPicking(true);
  find('.route-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function endPicking() {
  pickMode = null;
  find('#pick-banner').hidden = true;
  facilityMap.setPicking(false);
}

function chooseMapPoint(point) {
  if (!pickMode) return;
  if (pickMode === 'start') {
    draft.origin = { lat: point.lat, lng: point.lng };
    draft.originLabel = 'Chosen map start';
    facilityMap.setCenter(draft.origin, getRadius(), draft.originLabel);
    facilityMap.showRadius(!toiletRoute);
    loadNearby();
  } else {
    draft.stops.push({
      lat: point.lat,
      lng: point.lng,
      name: `Map stop ${draft.stops.length + 1}`,
    });
  }
  endPicking();
  clearResult();
  renderDraft();
  notify('Route updated. Create your route when ready.');
}

function elapsedTime() {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function showEstimate() {
  const estimate = routeEstimate(currentRoute, getRunningSpeed());
  find('#run-time-label').textContent = estimate.hasFerry
    ? 'Est. + ferry'
    : 'Estimated time';
  find('#run-time').textContent =
    estimate.minutes === null ? 'Unknown' : `~${estimate.minutes} min`;
  find('#run-speed-note').textContent = estimate.hasFerry
    ? 'Set speed · ferry'
    : 'Your setting';
  find('#run-speed').textContent = `${getRunningSpeed()} km/h`;
  find('#run-metrics').hidden = false;
}

function showResult(route, message) {
  currentRoute = route;
  facilityMap.showRoute(route);
  showEstimate();
  const offsetPin = route.waypoints?.some((point) => point.distance > 30);
  find('#route-result').innerHTML = `
    <p class="preview-distance"><strong>${(route.distance / 1000).toFixed(2)} km</strong> · ${draft.stops.length} stops</p>
    ${routeEstimate(route, getRunningSpeed()).hasFerry ? '<p class="notice">Includes a ferry. Check departures and access. Estimated time excludes waiting.</p>' : ''}
    ${offsetPin ? '<p class="notice">Some pins are offset from the path. Check the final approach.</p>' : ''}
    <button id="start-run" class="primary full">Start run</button>
    <p class="fine-print">${escapeHTML(message)}</p>`;
  find('#route-result').hidden = false;
  find('#start-run').onclick = startRun;
}

function startRun() {
  if (!currentRoute || !facilityMap.map || startedAt !== null) return;
  endPicking();
  startedAt = Date.now();
  find('#toast').hidden = true;
  runSession++;
  nearbyRequest++; // Ignore any facility load still in flight.
  document.body.classList.add('run-active');
  facilityMap.showFacilities([]);
  facilityMap.showRadius(false);
  find('#run-controls').hidden = false;
  find('#run-time-label').textContent = 'Elapsed time';
  find('#run-summary').textContent = '';
  find('#run-time').textContent = elapsedTime();
  // Use the start timestamp so backgrounded tabs catch up when they resume.
  timerInterval = setInterval(() => {
    find('#run-time').textContent = elapsedTime();
  }, 1000);
  requestAnimationFrame(() => {
    facilityMap.map.invalidateSize();
    facilityMap.showRoute(currentRoute);
    find('#end-run').focus({ preventScroll: true });
  });
}

function endRun() {
  if (startedAt === null) return;
  const elapsed = elapsedTime();
  clearInterval(timerInterval);
  startedAt = null;
  runSession++;
  document.body.classList.remove('run-active');
  find('#run-controls').hidden = true;
  find('#run-locate').disabled = false;
  facilityMap.clearCurrentLocation();
  facilityMap.showRadius(!toiletRoute);
  showEstimate();
  find('#run-summary').textContent = `Route ended · ${elapsed} elapsed`;
  loadNearby();
  requestAnimationFrame(() => {
    facilityMap.map?.invalidateSize();
    facilityMap.showRoute(currentRoute);
    find('#start-run').focus({ preventScroll: true });
  });
}

find('#end-run').onclick = endRun;
find('#run-locate').onclick = async () => {
  const session = runSession;
  find('#run-locate').disabled = true;
  try {
    const point = await getLocation();
    if (startedAt !== null && session === runSession)
      facilityMap.showCurrentLocation(point);
  } catch (error) {
    if (startedAt !== null && session === runSession) notify(error.message);
  } finally {
    if (session === runSession) find('#run-locate').disabled = false;
  }
};
window.addEventListener('pagehide', () => clearInterval(timerInterval));
window.addEventListener('pageshow', (event) => {
  if (event.persisted && startedAt !== null) {
    find('#run-time').textContent = elapsedTime();
    timerInterval = setInterval(() => {
      find('#run-time').textContent = elapsedTime();
    }, 1000);
  }
});

async function buildRoute(autoStart = false) {
  if (loadingRoute) return;
  if (!draft.stops.length) return notify('Add a facility or map stop first.');
  clearResult();
  const currentRequest = requestNumber;
  loadingRoute = true;
  find('#build-route').disabled = true;
  find('#build-route').textContent = 'Finding paths…';
  try {
    const points = [draft.origin, ...draft.stops];
    if (draft.roundTrip) points.push(draft.origin);
    const result = await getWalkingRoute(points, structuredClone(draft));
    const route = result.route;
    if (currentRequest !== requestNumber) return;
    showResult(
      route,
      result.savedRouteId
        ? 'Points saved to Past routes.'
        : 'Sign in to keep this route in Past routes.',
    );
    if (autoStart === true) startRun();
    else notify('Route ready. Tap Start run.');
  } catch (error) {
    if (currentRequest === requestNumber)
      find('#route-message').textContent = error.message;
    notify(error.message);
  } finally {
    loadingRoute = false;
    find('#build-route').disabled = false;
    find('#build-route').innerHTML = `${icon('route')}Preview route`;
  }
}

find('#route-location').onclick = () =>
  useLocation().catch((error) => notify(error.message));
find('#pick-start').onclick = () => startPicking('start');
find('#pick-stop').onclick = () => startPicking('stop');
find('#cancel-pick').onclick = endPicking;
find('#round-trip').onchange = (event) => {
  draft.roundTrip = event.target.checked;
  clearResult();
  renderDraft();
};
find('#clear-route').onclick = () => {
  draft.stops = [];
  clearResult();
  renderDraft();
};
find('#build-route').onclick = () => buildRoute();
find('#route-stops').onclick = (event) => {
  const remove = event.target.closest('[data-remove-stop]');
  const move = event.target.closest('[data-up-stop]');
  if (remove) draft.stops.splice(Number(remove.dataset.removeStop), 1);
  if (move) {
    const index = Number(move.dataset.upStop);
    [draft.stops[index - 1], draft.stops[index]] = [
      draft.stops[index],
      draft.stops[index - 1],
    ];
  }
  if (remove || move) {
    clearResult();
    renderDraft();
  }
};

async function start() {
  await loadAccount();
  find('#toilet-route-back').hidden = !toiletRoute;
  find('#toilet-route-back').href = `../index.html?quick=${nearestType}`;
  find('#toilet-route-back').textContent = '← Back to nearby facilities';
  document.body.classList.toggle('quick-route', toiletRoute);
  const query = new URLSearchParams(location.search);
  let saved;
  if (query.has('saved')) {
    saved = (await getPastRoutes()).find((row) => row.id === query.get('saved'));
    if (!saved) throw new Error('This saved route is unavailable for your account.');
    draft = saved.draft;
    showStart = draft.originLabel === 'Chosen map start';
  }
  facilityMap.setCenter(draft.origin, getRadius(), draft.originLabel);
  facilityMap.showRadius(!toiletRoute);
  renderDraft();
  loadNearby();
  if (saved) {
    // Restore the original start, even when the runner's current GPS location differs.
    facilityMap.frameChoices(draft.stops, draft.origin);
    find('#route-message').textContent =
      `Points saved ${formatDate(saved.createdAt)} loaded. Tap Preview route when ready.`;
  }
  if (query.has('nearest')) {
    find('#nearest-note').hidden = false;
    find('#nearest-note').textContent = 'Quick-search stop selected.';
  }
  if (query.has('build') && !saved) {
    history.replaceState(
      null,
      '',
      toiletRoute ? `./routes.html?nearest=${nearestType}` : './routes.html',
    );
    if (draft.originLabel === 'Brisbane preview start') {
      try {
        await useLocation();
      } catch {
        find('#route-message').textContent =
          'Choose your start on the map, then create the route.';
        return;
      }
    }
    await buildRoute(query.get('autostart') === '1');
  }
}
start().catch((error) => notify(error.message));
