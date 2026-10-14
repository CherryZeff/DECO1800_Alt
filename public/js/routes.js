// Route page: ordered stops, a chosen start, and walking-route results.
import {
  find,
  icon,
  escapeHTML,
  titleCase,
  formatDistance,
  notify,
  getLocation,
  setupDialogs,
} from './helpers.js';
import { getFacilities, getWalkingRoute } from './services.js';
import { FacilityMap } from './map.js';
import { readRoute, saveRoute } from './route-state.js';
import { setupFacilityDetails } from './facility-details.js';

import { loadAccount, getRadius } from './storage.js';

const toiletRoute = new URLSearchParams(location.search).has('nearest');
let draft = readRoute();
let facilities = [];
let pickMode = null;
let requestNumber = 0;
let loadingRoute = false;
let nearbyRequest = 0;
const details = setupFacilityDetails(loadNearby, () => {
  draft = readRoute();
  clearResult();
  renderDraft();
  notify('Stop added to your route.');
});
const facilityMap = new FacilityMap((facility) => {
  if (!pickMode) details.open(facility);
}, chooseMapPoint);
setupDialogs();

function clearResult() {
  requestNumber++;
  facilityMap.clearRoute();
  find('#route-result').hidden = true;
  find('#route-message').textContent = '';
}

function renderDraft() {
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
    if (current !== nearbyRequest) return;
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
  if (!facilityMap.map) return notify('The map is unavailable. Check your connection.');
  if (mode === 'stop' && draft.stops.length >= 10)
    return notify('A route can include up to 10 stops.');
  pickMode = mode;
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

function instruction(step) {
  let text = step.maneuver.type.replaceAll('_', ' ');
  text = text[0].toUpperCase() + text.slice(1);
  if (step.maneuver.modifier) text += ` ${step.maneuver.modifier}`;
  if (step.name) text += ` onto ${step.name}`;
  return text;
}

async function buildRoute() {
  if (loadingRoute) return;
  if (!draft.stops.length) return notify('Add a facility or map stop first.');
  clearResult();
  const currentRequest = requestNumber;
  loadingRoute = true;
  find('#build-route').disabled = true;
  find('#build-route').textContent = 'Finding a walking route…';
  try {
    const points = [draft.origin, ...draft.stops];
    if (draft.roundTrip) points.push(draft.origin);
    const route = await getWalkingRoute(points);
    if (currentRequest !== requestNumber) return;
    facilityMap.showRoute(route);
    const steps = route.legs.flatMap((leg) => leg.steps).filter((step) => step.distance > 0);
    const offsetPin = route.waypoints?.some((point) => point.distance > 30);
    find('#route-result').innerHTML = `
      <div class="route-stats">
        <div><strong>${(route.distance / 1000).toFixed(2)} km</strong><span>Total distance</span></div>
        <div><strong>${Math.max(1, Math.round(route.duration / 60))} min</strong><span>Walking time</span></div>
      </div>
      <p>${draft.stops.length} stops · ${draft.roundTrip ? 'Return to start' : 'One way'}</p>
      ${offsetPin ? '<p class="notice">Some pins are offset from the mapped path. Check the final approach to each stop.</p>' : ''}
      <details><summary>Walking directions</summary><ol class="directions">
        ${steps.map((step) => `<li>${escapeHTML(instruction(step))} <strong>${formatDistance(step.distance)}</strong></li>`).join('')}
      </ol></details>
      <p class="fine-print">Route preview, not live navigation. <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">OSRM / FOSSGIS</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Fix the map</a></p>`;
    find('#route-result').hidden = false;
    notify('Your walking route is ready.');
  } catch (error) {
    if (currentRequest === requestNumber) find('#route-message').textContent = error.message;
    notify(error.message);
  } finally {
    loadingRoute = false;
    find('#build-route').disabled = false;
    find('#build-route').innerHTML = `${icon('route')}Create walking route`;
  }
}

find('#route-location').onclick = () => useLocation().catch((error) => notify(error.message));
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
find('#build-route').onclick = buildRoute;
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
  facilityMap.setCenter(draft.origin, getRadius(), draft.originLabel);
  facilityMap.showRadius(!toiletRoute);
  renderDraft();
  loadNearby();
  const query = new URLSearchParams(location.search);
  if (query.has('nearest')) find('#nearest-note').hidden = false;
  if (query.has('build')) {
    history.replaceState(null, '', toiletRoute ? './routes.html?nearest=1' : './routes.html');
    if (draft.originLabel === 'Brisbane preview start') {
      try {
        await useLocation();
      } catch {
        find('#route-message').textContent =
          'Choose your start on the map, then create the route.';
        return;
      }
    }
    buildRoute();
  }
}
start().catch((error) => notify(error.message));
