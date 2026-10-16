// Home page: nearby facilities, map modes, and new facility pins.
import {
  find,
  icon,
  escapeHTML,
  distanceBetween,
  notify,
  getLocation,
  handleForm,
  setupDialogs,
  amenityNames,
  pageURL,
} from './helpers.js';
import {
  requireAccount,
  addFacility,
  loadAccount,
  getRadius,
  getPreferences,
  getRunningSpeed,
} from './storage.js';
import {
  openingStatus,
  parseFacilitySearch,
  matchesFacilitySearch,
} from './facility-search.js';
import { quickType } from './quick-search.js';
import { apiRequest } from './api.js';
import { getFacilities, previewWalkingRoute } from './services.js';
import { FacilityMap } from './map.js';
import { setupFacilityDetails } from './facility-details.js';
import { readRoute, saveRoute } from './route-state.js';

import { readPhotos, showPhotoPreview, clearPhotoPreview } from './photos.js';

const draft = readRoute();
const state = {
  center: draft.origin,
  centerLabel: draft.originLabel,
  radius: 5000,
  facilities: [],
  filter: 'all',
  warnings: [],
  storesAvailable: true,
  pin: null,
  picking: false,
};
let requestNumber = 0;
let nearestMode = false;
let nearestType = 'toilet';
let searchFilters = null;
const typeLabels = { toilet: 'toilets', water: 'water fountains', store: 'stores' };
let nearestRequest = 0;
let previewRequest = 0;
let toiletChoices = [];
let findingToilets = false;
let choosingToilet = false;
let previousArea = null;
const details = setupFacilityDetails(refreshReports);
const facilityMap = new FacilityMap(
  (facility) => {
    if (!state.picking) chooseFacility(facility);
  },
  (point) => {
    if (state.picking) finishPin(point);
  },
);
setupDialogs();

async function refreshReports() {
  await loadFacilities();
}

function matchesPreferences(facility) {
  const preferences = getPreferences();
  if (preferences.hideIssues && facility.openReports) return false;
  const keys =
    facility.type === 'toilet'
      ? ['accessible', 'unisex', 'babychange']
      : facility.type === 'water'
        ? ['bottle']
        : [];
  return keys.every((key) => !preferences[key] || facility.amenities.includes(key));
}

function mustBeOpen() {
  return searchFilters
    ? searchFilters.open
    : getPreferences().quickOpenOnly !== false;
}
function matchingFacilities() {
  return state.facilities
    .filter((facility) => {
      const matchesType = nearestMode
        ? facility.type === nearestType
        : state.filter === 'all' || state.filter === facility.type;
      if (nearestMode && mustBeOpen() && openingStatus(facility.hours) !== 'open')
        return false;
      if (
        nearestMode &&
        searchFilters &&
        !matchesFacilitySearch(facility, searchFilters)
      )
        return false;
      return matchesType && matchesPreferences(facility);
    })
    .sort(
      (first, second) =>
        distanceBetween(state.center, first) - distanceBetween(state.center, second),
    );
}

function visibleFacilities() {
  return nearestMode
    ? toiletChoices.map((choice) => choice.facility)
    : matchingFacilities();
}

function chooseFacility(facility) {
  if (!nearestMode) return details.open(facility);
  if (
    choosingToilet ||
    !toiletChoices.some((choice) => choice.facility.id === facility.id)
  )
    return;
  choosingToilet = true;
  previewRequest++; // Stop the remaining candidate search as soon as a toilet is chosen.
  nearestRequest++;
  saveRoute({
    origin: { ...state.center },
    originLabel: 'Your location',
    stops: [
      {
        id: facility.id,
        name: facility.name,
        lat: facility.lat,
        lng: facility.lng,
      },
    ],
    roundTrip: false,
  });
  location.href = pageURL(`routes.html?build=1&nearest=${nearestType}&autostart=1`);
}

function renderFacilities() {
  const facilities = visibleFacilities();
  find('#facility-count').textContent = nearestMode
    ? findingToilets
      ? `Finding reachable ${typeLabels[nearestType]}… ${facilities.length} found`
      : `${facilities.length} reachable ${typeLabels[nearestType]} within ${state.radius / 1000} km`
    : `${facilities.length} nearby stops`;
  const warnings = [...state.warnings];
  if (nearestMode && !findingToilets && !facilities.length)
    warnings.push(
      mustBeOpen()
        ? 'No reachable matches with confirmed opening hours. Try a larger radius or disable Only find facilities open now in Settings.'
        : 'No reachable matches. Try a larger radius or different preferences.',
    );
  if (!nearestMode && state.filter === 'store' && !state.storesAvailable) {
    warnings.push('Store locations have not been imported yet.');
  }
  find('#data-warning').textContent = warnings.join(' ');
  find('#data-warning').hidden = !warnings.length;
  facilityMap.showFacilities(facilities, !nearestMode);
  if (nearestMode) facilityMap.showRouteChoices(toiletChoices, getRunningSpeed());
}

async function loadToiletPreviews(facilities) {
  const current = ++previewRequest;
  const origin = { ...state.center };
  toiletChoices = [];
  findingToilets = true;
  renderFacilities();
  // Check candidates in distance order until three valid paths are found or the radius is exhausted.
  for (const facility of facilities) {
    if (!nearestMode || current !== previewRequest) return;
    let route;
    try {
      route = await previewWalkingRoute([origin, facility]);
    } catch (error) {
      if (!nearestMode || current !== previewRequest) return;
      if (error.status === 422) continue; // No pedestrian path: try the next toilet.
      state.warnings.push(
        'Route service unavailable. Some facilities could not be checked. Retry to continue.',
      );
      break;
    }
    if (!nearestMode || current !== previewRequest) return;
    toiletChoices.push({ facility, route, loading: false });
    renderFacilities();
    if (toiletChoices.length === 3) break;
  }
  if (!nearestMode || current !== previewRequest) return;
  findingToilets = false;
  renderFacilities();
  const choices = toiletChoices;
  if (choices.some((choice) => choice.route) && facilityMap.map) {
    const bounds = L.latLngBounds(
      [origin.lat, origin.lng],
      [origin.lat, origin.lng],
    );
    for (const choice of choices) {
      bounds.extend([choice.facility.lat, choice.facility.lng]);
      if (choice.route)
        for (const [lng, lat] of choice.route.geometry.coordinates)
          bounds.extend([lat, lng]);
    }
    facilityMap.map.fitBounds(bounds, {
      paddingTopLeft: [100, 180],
      paddingBottomRight: [100, 180],
      maxZoom: 16,
    });
  }
}

async function loadFacilities() {
  const currentRequest = ++requestNumber;
  find('#facility-count').textContent = 'Finding facilities…';
  find('#retry-data').disabled = true;
  try {
    const result = await getFacilities(state.center, state.radius);
    if (currentRequest !== requestNumber) return false;
    state.facilities = result.facilities;
    state.storesAvailable = result.storesAvailable !== false;
    state.warnings = result.warnings;
    if (
      nearestMode &&
      state.warnings.some((warning) =>
        warning
          .toLowerCase()
          .includes(nearestType === 'water' ? 'fountain' : nearestType),
      )
    )
      state.facilities = [];
    if (nearestMode) await loadToiletPreviews(matchingFacilities());
    else renderFacilities();
    if (state.warnings.length) notify(state.warnings.join(' '));
    return true;
  } catch (error) {
    if (currentRequest === requestNumber) {
      state.facilities = [];
      state.warnings = [error.message];
      renderFacilities();
      notify(error.message);
    }
    return false;
  } finally {
    if (currentRequest === requestNumber) find('#retry-data').disabled = false;
  }
}

function updateCenter(point, label) {
  state.center = point;
  state.centerLabel = label;
  facilityMap.setCenter(point, state.radius, label);
  facilityMap.showRadius(!nearestMode);
  find('#radius-link').textContent = `Radius: ${state.radius / 1000} km ↗`;
  const route = readRoute();
  route.origin = point;
  route.originLabel = label;
  saveRoute(route);
}

async function locate() {
  const currentMode = nearestRequest;
  find('#locate').disabled = true;
  try {
    const point = await getLocation();
    if (nearestMode || currentMode !== nearestRequest) return;
    updateCenter(point, 'Your location');
    const loaded = await loadFacilities();
    if (!loaded)
      throw new Error(
        'Facilities are still loading or unavailable. Please try again.',
      );
    return point;
  } finally {
    find('#locate').disabled = false;
  }
}

async function nearestToilet(type = quickType(), filters = null) {
  if (nearestMode) leaveNearestMode();
  nearestType = ['toilet', 'water', 'store'].includes(type) ? type : 'toilet';
  searchFilters = filters;
  previousArea = { center: state.center, centerLabel: state.centerLabel };
  nearestMode = true;
  toiletChoices = [];
  choosingToilet = false;
  const current = ++nearestRequest;
  requestNumber++; // Ignore an older area request that finishes after this switch.
  document.body.classList.add('nearest-mode');
  find('#nearest-back').hidden = false;
  find('#map-mode').textContent = `Closest ${typeLabels[nearestType]}`;
  find('#nearest-toilet').disabled = true;
  state.facilities = [];
  state.warnings = [];
  renderFacilities();
  find('#facility-count').textContent = 'Finding your location…';
  facilityMap.showRadius(false);
  try {
    const point = await getLocation();
    if (current !== nearestRequest) return;
    updateCenter(point, 'Your location');
    const loaded = await loadFacilities();
    if (current !== nearestRequest || !loaded) return;
    const toilets = visibleFacilities();
    notify(
      toilets.length
        ? 'Tap a facility pin or bubble to start your route.'
        : 'No matching facilities available in this radius. Go back to change your radius or retry.',
    );
  } catch (error) {
    if (current !== nearestRequest) return;
    state.warnings = [error.message];
    renderFacilities();
    notify(error.message);
  } finally {
    if (current === nearestRequest) find('#nearest-toilet').disabled = false;
  }
}

function leaveNearestMode() {
  previewRequest++;
  facilityMap.clearRouteChoices();
  nearestRequest++;
  requestNumber++;
  nearestMode = false;
  toiletChoices = [];
  findingToilets = false;
  document.body.classList.remove('nearest-mode');
  find('#nearest-back').hidden = true;
  find('#nearest-toilet').disabled = false;
  updateModeControls();
  updateCenter(previousArea.center, previousArea.centerLabel);
  state.facilities = [];
  renderFacilities();
  const url = new URL(location.href);
  url.searchParams.delete('toilets');
  url.searchParams.delete('quick');
  history.replaceState(null, '', url);
  loadFacilities();
}

// Each button previews the icon and colour of its destination mode.
const modes = [
  { type: 'all', label: 'All stops' },
  { type: 'toilet', label: 'Toilets' },
  { type: 'water', label: 'Water fountains' },
  { type: 'store', label: 'Convenience stores' },
];
function updateModeControls() {
  const current = modes.findIndex((mode) => mode.type === state.filter);
  find('#map-mode').textContent = modes[current].label;
  for (const [selector, direction] of [
    ['#previous-mode', -1],
    ['#next-mode', 1],
  ]) {
    const next = modes[(current + direction + modes.length) % modes.length];
    const button = find(selector);
    button.dataset.mode = next.type;
    button.innerHTML = `${icon(next.type)}<span aria-hidden="true">${direction < 0 ? '&lt;' : '&gt;'}</span>`;
    button.setAttribute('aria-label', `Show ${next.label.toLowerCase()}`);
    button.title = next.label;
    button.onclick = () => {
      state.filter = next.type;
      updateModeControls();
      renderFacilities();
    };
  }
}
updateModeControls();

function updateAmenities() {
  const type = find('#add-form [name=type]').value;
  const toilet = type === 'toilet';
  const keys = toilet
    ? ['accessible', 'babychange']
    : type === 'store'
      ? ['accessible']
      : ['accessible', 'bottle', 'dog'];
  find('#add-form [name=name]').placeholder =
    type === 'store'
      ? 'e.g. NightOwl West End'
      : toilet
        ? 'e.g. Riverside public toilets'
        : 'e.g. Riverside drinking fountain';
  find('#add-toilet-details').hidden = !toilet;
  find('#add-toilet-details').disabled = !toilet;
  find('#add-amenities').innerHTML = keys
    .map(
      (key) => `
    <label class="check-row"><input type="checkbox" name="amenity" value="${key}"><span>${amenityNames[key]}</span></label>
  `,
    )
    .join('');
}

function showAddForm() {
  if (!requireAccount('index.html?add=1')) return;
  find('#add-form').reset();
  clearPhotoPreview();
  state.pin = null;
  find('#pin-description').textContent = 'Choose a location below.';
  find('#add-form .form-error').textContent = '';
  updateAmenities();
  find('#add-dialog').showModal();
}

function finishPin(point) {
  state.picking = false;
  facilityMap.setPicking(false);
  find('#pick-banner').hidden = true;
  document.body.classList.remove('picking');
  if (point) {
    state.pin = { lat: point.lat, lng: point.lng };
    find('#pin-description').textContent =
      `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  }
  find('#add-dialog').showModal();
}

find('#add-map-location').onclick = () => {
  if (!facilityMap.map)
    return notify('The map is unavailable. Try using your location.');
  find('#add-dialog').close();
  state.picking = true;
  document.body.classList.add('picking');
  facilityMap.setPicking(true);
  find('#pick-message').textContent = 'Tap the map to place your facility.';
  find('#pick-banner').hidden = false;
};
find('#cancel-pick').onclick = () => finishPin(null);
find('#add-current-location').onclick = async () => {
  const button = find('#add-current-location');
  button.disabled = true;
  try {
    state.pin = await getLocation();
    find('#pin-description').textContent =
      `${state.pin.lat.toFixed(5)}, ${state.pin.lng.toFixed(5)}`;
    find('#add-form .form-error').textContent = '';
  } catch (error) {
    find('#add-form .form-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
handleForm(find('#add-form'), async (form) => {
  if (!state.pin) throw new Error('Use your location or place a pin first.');
  const facility = await addFacility({
    photos: await readPhotos(find('#facility-photos')),
    type: form.get('type'),
    name: form.get('name').trim(),
    ...state.pin,
    amenities: form.getAll('amenity'),
    ...(form.get('type') === 'toilet'
      ? {
          toiletDetails: {
            ...Object.fromEntries(
              ['male', 'female', 'unisex', 'allgender'].map((key) => [
                key,
                form.getAll('toiletType').includes(key) ? true : null,
              ]),
            ),
            shower:
              form.get('shower') === 'yes'
                ? true
                : form.get('shower') === 'no'
                  ? false
                  : null,
          },
        }
      : {}),
    description: form.get('description').trim(),
    hours: form.get('hours').trim() || 'Opening hours not provided',
  });
  find('#add-dialog').close();
  clearPhotoPreview();
  // Keep a newly added distant pin inside the saved map area on the next visit.
  if (distanceBetween(state.center, facility) > state.radius)
    updateCenter(facility, 'Around your submission');
  await loadFacilities();
  if (!visibleFacilities().some((item) => item.id === facility.id))
    facilityMap.addFacility(facility);
  facilityMap.focus(facility);
  details.open(facility);
  notify('Facility saved and shared.');
});

// Page-specific controls. Normal navigation uses links in the HTML.
find('#add-form [name=type]').onchange = updateAmenities;
find('#add-facility').onclick = showAddForm;
find('#nearest-toilet').addEventListener('quick-search', (event) =>
  nearestToilet(event.detail),
);
find('#locate').onclick = () => locate().catch((error) => notify(error.message));
find('#retry-data').onclick = loadFacilities;
find('#nearest-back').onclick = leaveNearestMode;
find('#facility-photos').onchange = (event) => {
  try {
    showPhotoPreview(event.target);
    find('#add-form .form-error').textContent = '';
  } catch (error) {
    event.target.value = '';
    clearPhotoPreview();
    find('#add-form .form-error').textContent = error.message;
  }
};
// Search only on submit, not every keystroke. Choosing a result reloads that area.
let placeResults = [];
find('#place-search').onsubmit = async (event) => {
  event.preventDefault();
  const filters = parseFacilitySearch(find('#place-query').value.trim());
  if (filters) {
    find('#place-results').hidden = true;
    await nearestToilet(filters.type, filters);
    return;
  }
  const button = find('#place-search [type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  find('#place-results').hidden = false;
  find('#place-options').replaceChildren();
  find('#place-status').textContent = 'Searching places and stores…';
  try {
    placeResults = (
      await apiRequest(
        `search?q=${encodeURIComponent(find('#place-query').value.trim())}`,
      )
    ).places;
    find('#place-status').textContent = placeResults.length
      ? 'Choose a place to explore nearby facilities.'
      : 'No places found. Try a suburb, park or store name.';
    find('#place-options').innerHTML = placeResults
      .map(
        (place, index) =>
          `<button type="button" data-place="${index}">${escapeHTML(place.name)}</button>`,
      )
      .join('');
  } catch (error) {
    find('#place-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
find('#place-options').onclick = async (event) => {
  const button = event.target.closest('[data-place]');
  if (!button) return;
  const place = placeResults[Number(button.dataset.place)];
  nearestRequest++; // An outstanding GPS request must not overwrite the chosen place.
  sessionStorage.setItem('parkpal.locationAsked', 'yes');
  updateCenter({ lat: place.lat, lng: place.lng }, place.name.split(',')[0]);
  find('#place-results').hidden = true;
  await loadFacilities();
  if (place.facilityId) {
    const facility = state.facilities.find((row) => row.id === place.facilityId);
    if (facility) {
      if (!visibleFacilities().includes(facility)) facilityMap.addFacility(facility);
      facilityMap.focus(facility);
      details.open(facility);
    }
  }
};
find('#close-search').onclick = () => {
  find('#place-results').hidden = true;
};
find('#place-search').onkeydown = (event) => {
  if (event.key === 'Escape') find('#place-results').hidden = true;
};

async function start() {
  await loadAccount();
  state.radius = getRadius();
  const query = new URLSearchParams(location.search);
  const lat = Number(query.get('lat'));
  const lng = Number(query.get('lng'));
  const hasMapLink =
    query.has('lat') &&
    query.has('lng') &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;
  if (hasMapLink) updateCenter({ lat, lng }, 'Selected map area');
  else updateCenter(state.center, state.centerLabel);
  if (query.has('toilets') || query.has('quick')) {
    await nearestToilet(query.get('quick') || 'toilet');
    return;
  }
  await loadFacilities();
  if (hasMapLink) facilityMap.focus({ lat, lng });
  if (query.has('facility')) {
    const facility = (
      await apiRequest(`facility?id=${encodeURIComponent(query.get('facility'))}`)
    ).facility;
    if (!state.facilities.some((row) => row.id === facility.id))
      facilityMap.addFacility(facility);
    facilityMap.focus(facility);
    details.open(facility);
  }
  if (query.has('add')) showAddForm();
  // Ask only on the first visit in a tab. Keep a denied location as a labelled preview.
  if (!hasMapLink && !sessionStorage.getItem('parkpal.locationAsked')) {
    sessionStorage.setItem('parkpal.locationAsked', 'yes');
    locate().catch(() =>
      notify(
        'Showing a Brisbane preview. Use the location button or choose a route start.',
      ),
    );
  }
}
start().catch((error) => notify(error.message));
