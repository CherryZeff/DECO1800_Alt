// Home page: nearby facilities, the bottom sheet, and new facility pins.
import {
  find,
  icon,
  escapeHTML,
  titleCase,
  distanceBetween,
  formatDistance,
  notify,
  getLocation,
  handleForm,
  setupDialogs,
  amenityNames,
  pageURL,
} from './helpers.js';
import { getAccount, requireAccount, addFacility } from './storage.js';
import { getFacilities, attachReportCounts } from './services.js';
import { FacilityMap } from './map.js';
import { setupFacilityDetails } from './facility-details.js';
import { readRoute, saveRoute } from './route-state.js';

const draft = readRoute();
const state = {
  center: draft.origin,
  centerLabel: draft.originLabel,
  radius: 5000,
  facilities: [],
  filter: 'all',
  search: '',
  limit: 20,
  warnings: [],
  pin: null,
  picking: false,
};
let requestNumber = 0;
const details = setupFacilityDetails(refreshReports);
const facilityMap = new FacilityMap(
  (facility) => {
    if (!state.picking) details.open(facility);
  },
  (point) => {
    if (state.picking) finishPin(point);
  },
);
setupDialogs();

function refreshReports() {
  state.facilities = attachReportCounts(state.facilities);
  renderFacilities();
}

function matchesPreferences(facility) {
  const preferences = getAccount()?.preferences || {};
  if (preferences.hideIssues && facility.openReports) return false;
  const keys = facility.type === 'toilet' ? ['accessible', 'unisex', 'babychange'] : ['bottle'];
  return keys.every((key) => !preferences[key] || facility.amenities.includes(key));
}

function visibleFacilities() {
  return state.facilities
    .filter((facility) => {
      const matchesType = state.filter === 'all' || state.filter === facility.type;
      const matchesSearch = `${facility.name} ${facility.address}`
        .toLowerCase()
        .includes(state.search);
      return matchesType && matchesSearch && matchesPreferences(facility);
    })
    .sort(
      (first, second) =>
        distanceBetween(state.center, first) - distanceBetween(state.center, second),
    );
}

function renderFacilities() {
  const facilities = visibleFacilities();
  find('#facility-count').textContent = `${facilities.length} nearby stops`;
  find('#data-warning').textContent = state.warnings.join(' ');
  find('#data-warning').hidden = !state.warnings.length;
  const shown = facilities.slice(0, state.limit);
  find('#facility-list').innerHTML =
    shown
      .map(
        (facility) => `
    <button class="facility-card" data-facility="${escapeHTML(facility.id)}">
      <span class="facility-symbol ${facility.type}">${icon(facility.type)}</span>
      <span class="facility-copy">
        <strong>${escapeHTML(titleCase(facility.name))}</strong>
        <span class="${facility.openReports ? 'issue-text' : 'muted'}">${facility.openReports ? `${facility.openReports} open reports` : facility.type === 'water' ? 'Drinking water' : 'Public toilet'}${facility.source === 'Community' ? ' · Local pin' : ''}</span>
      </span>
      <span class="facility-distance">${formatDistance(distanceBetween(state.center, facility))}</span>
    </button>
  `,
      )
      .join('') ||
    '<p class="empty-state">No matching stops. Try a larger radius or change your preferences.</p>';
  if (facilities.length > shown.length) {
    find('#facility-list').insertAdjacentHTML(
      'beforeend',
      '<button id="more-facilities" class="secondary full">Show more stops</button>',
    );
    find('#more-facilities').onclick = () => {
      state.limit += 20;
      renderFacilities();
    };
  }
  facilityMap.showFacilities(facilities);
}

async function loadFacilities() {
  const currentRequest = ++requestNumber;
  find('#facility-count').textContent = 'Finding facilities…';
  find('#retry-data').disabled = true;
  try {
    const result = await getFacilities(state.center, state.radius);
    if (currentRequest !== requestNumber) return false;
    state.facilities = result.facilities;
    state.warnings = result.warnings;
    renderFacilities();
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
  find('#location-label').textContent = `${label} · ${state.radius / 1000} km`;
  facilityMap.setCenter(point, state.radius, label);
  const route = readRoute();
  route.origin = point;
  route.originLabel = label;
  saveRoute(route);
}

async function locate() {
  find('#locate').disabled = true;
  try {
    const point = await getLocation();
    updateCenter(point, 'Your location');
    const loaded = await loadFacilities();
    if (!loaded) throw new Error('Facilities are still loading or unavailable. Please try again.');
    return point;
  } finally {
    find('#locate').disabled = false;
  }
}

async function nearestToilet() {
  const button = find('#nearest-toilet');
  button.disabled = true;
  try {
    await locate();
    if (state.warnings.some((warning) => warning.includes('toilets'))) {
      throw new Error('Toilet data is unavailable. Refresh and try again.');
    }
    const toilets = state.facilities.filter(
      (facility) => facility.type === 'toilet' && matchesPreferences(facility),
    );
    toilets.sort(
      (first, second) =>
        distanceBetween(state.center, first) - distanceBetween(state.center, second),
    );
    if (!toilets.length)
      throw new Error(
        'No matching toilet nearby. Expand the list to change your radius or preferences.',
      );
    const route = readRoute();
    route.stops = [toilets[0]];
    route.roundTrip = false;
    saveRoute(route);
    location.href = pageURL('routes.html?build=1&nearest=1');
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

// The sheet works with a tap, keyboard activation, or a vertical handle swipe.
function setSheetExpanded(expanded) {
  find('#facility-sheet').dataset.state = expanded ? 'expanded' : 'peek';
  find('#sheet-content').hidden = !expanded;
  find('#toggle-sheet').setAttribute('aria-expanded', String(expanded));
  find('#sheet-action').textContent = expanded ? 'Hide list ↓' : 'Show list ↑';
}
find('#toggle-sheet').onclick = () =>
  setSheetExpanded(find('#facility-sheet').dataset.state !== 'expanded');
let pointerStart;
let skipClick = false;
find('#toggle-sheet').addEventListener('pointerdown', (event) => {
  pointerStart = event.clientY;
  event.currentTarget.setPointerCapture(event.pointerId);
});
find('#toggle-sheet').addEventListener('pointerup', (event) => {
  const change = event.clientY - pointerStart;
  if (Math.abs(change) > 25) {
    skipClick = true;
    setSheetExpanded(change < 0);
  }
});
find('#toggle-sheet').addEventListener(
  'click',
  (event) => {
    if (skipClick) {
      event.stopImmediatePropagation();
      skipClick = false;
    }
  },
  true,
);

function updateAmenities() {
  const toilet = find('#add-form [name=type]').value === 'toilet';
  const keys = toilet ? ['accessible', 'unisex', 'babychange'] : ['accessible', 'bottle', 'dog'];
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
    find('#pin-description').textContent = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  }
  find('#add-dialog').showModal();
}

find('#add-map-location').onclick = () => {
  if (!facilityMap.map) return notify('The map is unavailable. Try using your location.');
  find('#add-dialog').close();
  setSheetExpanded(false);
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
handleForm(find('#add-form'), (form) => {
  if (!state.pin) throw new Error('Use your location or place a pin first.');
  const facility = addFacility({
    type: form.get('type'),
    name: form.get('name').trim(),
    ...state.pin,
    amenities: form.getAll('amenity'),
    description: form.get('description').trim(),
    hours: form.get('hours').trim() || 'Opening hours not provided',
  });
  find('#add-dialog').close();
  if (distanceBetween(state.center, facility) <= state.radius) {
    state.facilities.push(facility);
    renderFacilities();
  }
  if (!visibleFacilities().some((item) => item.id === facility.id))
    facilityMap.addFacility(facility);
  facilityMap.focus(facility);
  details.open(facility);
  notify('Facility saved on this browser.');
});

// Page-specific controls. Normal navigation uses links in the HTML.
find('#add-form [name=type]').onchange = updateAmenities;
find('#add-facility').onclick = showAddForm;
find('#add-from-list').onclick = showAddForm;
find('#nearest-toilet').onclick = nearestToilet;
find('#locate').onclick = () => locate().catch((error) => notify(error.message));
find('#retry-data').onclick = loadFacilities;
find('#radius').onchange = (event) => {
  state.radius = Number(event.target.value);
  updateCenter(state.center, state.centerLabel);
  loadFacilities();
};
find('#facility-search').oninput = (event) => {
  state.search = event.target.value.trim().toLowerCase();
  state.limit = 20;
  renderFacilities();
};
document.querySelectorAll('[data-filter]').forEach((button) => {
  button.onclick = () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((filter) => {
      const active = filter === button;
      filter.classList.toggle('active', active);
      filter.setAttribute('aria-pressed', String(active));
    });
    state.limit = 20;
    renderFacilities();
  };
});
find('#facility-list').onclick = (event) => {
  const button = event.target.closest('[data-facility]');
  if (!button) return;
  const facility = state.facilities.find((item) => item.id === button.dataset.facility);
  if (facility) details.open(facility);
};

async function start() {
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
  await loadFacilities();
  if (hasMapLink) facilityMap.focus({ lat, lng });
  if (query.has('add')) showAddForm();
  // Ask only on the first visit in a tab. Keep a denied location as a labelled preview.
  if (!hasMapLink && !sessionStorage.getItem('parkpal.locationAsked')) {
    sessionStorage.setItem('parkpal.locationAsked', 'yes');
    locate().catch(() =>
      notify('Showing a Brisbane preview. Use the location button or choose a route start.'),
    );
  }
}
start().catch((error) => notify(error.message));
