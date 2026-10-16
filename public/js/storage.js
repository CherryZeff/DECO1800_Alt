// Account records and personal collections live on the Node server.
// Guest preferences, appearance and the current route draft use browser storage.
import { pageURL } from './helpers.js';
import { apiRequest } from './api.js';

let currentAccount = null;

export async function loadAccount() {
  currentAccount = (await apiRequest('me')).user;
  return currentAccount;
}

export function getAccount() {
  return currentAccount;
}

export function requireAccount(returnPage = 'index.html') {
  if (!currentAccount) {
    location.href = pageURL(`accounts.html?next=${encodeURIComponent(returnPage)}`);
    return null;
  }
  return currentAccount;
}

export async function registerAccount(name, email, password) {
  currentAccount = (await apiRequest('register', 'POST', { name, email, password }))
    .user;
  return currentAccount;
}

export async function signIn(email, password) {
  currentAccount = (await apiRequest('login', 'POST', { email, password })).user;
  return currentAccount;
}

export async function signOut() {
  await apiRequest('logout', 'POST', {});
  currentAccount = null;
}

export async function savePreferences(preferences) {
  if (currentAccount)
    currentAccount = (await apiRequest('preferences', 'PUT', preferences)).user;
  else localStorage.setItem('parkpal.preferences', JSON.stringify(preferences));
}

export function getRadius() {
  const radius =
    currentAccount?.preferences.radius ??
    Number(localStorage.getItem('parkpal.radius') || 5000);
  return Number.isInteger(radius) &&
    radius >= 1000 &&
    radius <= 10000 &&
    radius % 1000 === 0
    ? radius
    : 5000;
}

export async function saveRadius(radius) {
  if (currentAccount)
    await savePreferences({ ...currentAccount.preferences, radius });
  else localStorage.setItem('parkpal.radius', String(radius));
}

export async function addFacility(input) {
  return (await apiRequest('submissions', 'POST', input)).facility;
}

export async function getReports(facilityId) {
  const query = facilityId ? `?facility=${encodeURIComponent(facilityId)}` : '';
  const result = await apiRequest(`reports${query}`);
  return [
    ...result.reports,
    ...result.unresolved.filter(
      (report) => !result.reports.some((recent) => recent.id === report.id),
    ),
  ];
}

export async function addReport(facility, category, description, photos = []) {
  return (
    await apiRequest('reports', 'POST', {
      facilityId: facility.id,
      photos,
      category,
      description,
    })
  ).report;
}

export async function resolveReport(id, photos) {
  await apiRequest(`reports/${encodeURIComponent(id)}/resolve`, 'POST', { photos });
}
export async function reopenReport(id) {
  await apiRequest(`reports/${encodeURIComponent(id)}/reopen`, 'POST', {});
}

export function getPreferences() {
  if (currentAccount) return currentAccount.preferences;
  try {
    return JSON.parse(localStorage.getItem('parkpal.preferences') || '{}');
  } catch {
    return {};
  }
}
export function getRunningSpeed() {
  const speed = getPreferences().runningSpeed;
  return Number.isFinite(speed) &&
    speed >= 6 &&
    speed <= 20 &&
    Number.isInteger(speed * 2)
    ? speed
    : 10;
}
export async function updateAccount(input) {
  currentAccount = (await apiRequest('account', 'PUT', input)).user;
}
export async function getFavourites() {
  return (await apiRequest('favourites')).favourites;
}
export async function setFavourite(facilityId, saved) {
  await apiRequest('favourites', saved ? 'POST' : 'DELETE', { facilityId });
}
export async function markVisited(facilityId) {
  await apiRequest('visits', 'POST', { facilityId });
}
export async function getPastRoutes() {
  return (await apiRequest('routes')).routes;
}
