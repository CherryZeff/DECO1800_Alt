// Small utilities shared by the pages. No framework or build step is needed.
export function find(selector) {
  return document.querySelector(selector);
}

export function icon(name) {
  const symbols = new URL('../icons.svg', import.meta.url);
  return `<svg class="icon" aria-hidden="true"><use href="${symbols}#i-${name}"></use></svg>`;
}

// Home lives at the project root; the other pages stay inside public/.
// Resolve from this module so links also work when hosted in a subdirectory.
export function pageURL(page) {
  const path = page.startsWith('index.html') ? `../../${page}` : `../${page}`;
  return new URL(path, import.meta.url).href;
}

// Escape contributed text before inserting it into an HTML template.
export function escapeHTML(value) {
  const characters = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (character) => characters[character]);
}

export function titleCase(value = '') {
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Straight-line distance in metres, using the haversine formula.
export function distanceBetween(start, end) {
  const radians = Math.PI / 180;
  const latitudeChange = (end.lat - start.lat) * radians;
  const longitudeChange = (end.lng - start.lng) * radians;
  const value =
    Math.sin(latitudeChange / 2) ** 2 +
    Math.cos(start.lat * radians) *
      Math.cos(end.lat * radians) *
      Math.sin(longitudeChange / 2) ** 2;
  return 12742000 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

export function formatDistance(metres) {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export function formatDate(value) {
  return new Date(value).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

let toastTimer;
export function notify(message) {
  const toast = find('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 6500);
}

export function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is unavailable. Choose a start on the map.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (location) => resolve({ lat: location.coords.latitude, lng: location.coords.longitude }),
      (error) =>
        reject(
          new Error(
            error.code === 1
              ? 'Location is blocked. Enable it in browser settings, or choose a map start.'
              : 'Could not find your location. Try again or choose a map start.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

// Every form gets the same busy state and a visible error message.
export function handleForm(form, action) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const errorMessage = form.querySelector('.form-error');
    if (button.disabled) return;
    button.disabled = true;
    errorMessage.textContent = '';
    try {
      await action(new FormData(form));
    } catch (error) {
      errorMessage.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

export function setupDialogs() {
  document.querySelectorAll('.close-dialog').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
}

export const amenityNames = {
  accessible: 'Wheelchair accessible',
  unisex: 'Unisex',
  babychange: 'Baby change',
  bottle: 'Bottle filling',
  dog: 'Dog bowl',
};
