// Three separate pages share account loading and small personal-library controls.
import { find, notify, escapeHTML, formatDate, pageURL } from './helpers.js';
import {
  loadAccount,
  getFavourites,
  setFavourite,
  getPastRoutes,
  resolveReport,
} from './storage.js';
import { apiRequest } from './api.js';
import { reportsHTML } from './reports.js';

async function render() {
  if (find('#history-list')) {
    const routes = await getPastRoutes();
    find('#history-list').innerHTML =
      routes
        .map(
          (row) => `<article class="menu-card">
      <h2>Route to ${escapeHTML(row.draft.stops.at(-1).name)}</h2><p>${formatDate(row.createdAt)} · ${row.draft.stops.length} stops${row.draft.roundTrip ? ' · Return to start' : ''}</p>
      <p>${escapeHTML(row.draft.originLabel)} → ${row.draft.stops.map((stop) => escapeHTML(stop.name)).join(' → ')}</p>
      <a class="primary" href="${pageURL(`routes.html?saved=${encodeURIComponent(row.id)}`)}">Reuse route</a></article>`,
        )
        .join('') ||
      '<p class="empty-state">Create a route while signed in to save it here.</p>';
  } else if (find('#favourites-list')) {
    const rows = await getFavourites();
    find('#favourites-list').innerHTML =
      rows
        .map((row) => {
          const facility = row.facility;
          const url = pageURL(
            `index.html?lat=${facility.lat}&lng=${facility.lng}&facility=${encodeURIComponent(facility.id)}`,
          );
          return `<article class="menu-card"><h2>${escapeHTML(facility.name)}</h2><p>${facility.type === 'toilet' ? 'Public toilet' : 'Drinking water'}</p><a class="primary" href="${url}">View facility</a><button class="text-button" data-unfavourite="${escapeHTML(facility.id)}">Remove favourite</button></article>`;
        })
        .join('') ||
      '<p class="empty-state">Open a facility and tap Favourite to save it here.</p>';
  } else {
    const result = await apiRequest(
      `my-activity?source=${find('#activity-source').value}`,
    );
    find('#activity-list').innerHTML = result.reports.length
      ? reportsHTML(result.reports)
      : '<p class="empty-state">No reports for these places. Favourite a facility, mark it visited, or use it as a route stop.</p>';
  }
}
async function refresh() {
  try {
    await render();
  } catch (error) {
    notify(error.message);
  }
}
if (find('#refresh-activity')) find('#refresh-activity').onclick = refresh;
if (find('#activity-source')) find('#activity-source').onchange = refresh;
find('#personal-content').onclick = async (event) => {
  const button = event.target.closest('[data-unfavourite], [data-resolve]');
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.unfavourite)
      await setFavourite(button.dataset.unfavourite, false);
    else await resolveReport(button.dataset.resolve);
    await render();
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
};
async function start() {
  document.querySelectorAll('.section-tabs a').forEach((link) => {
    if (new URL(link.href).pathname === location.pathname)
      link.setAttribute('aria-current', 'page');
  });
  const account = await loadAccount();
  if (!account) {
    const next = location.pathname.split('/').pop();
    find('#activity-auth').innerHTML =
      `<a class="primary" href="${pageURL(`accounts.html?next=${next}`)}">Sign in to see your places and routes</a>`;
    return;
  }
  find('#personal-content').hidden = false;
  await render();
}
start().catch((error) => {
  find('#activity-auth').textContent = error.message;
});
