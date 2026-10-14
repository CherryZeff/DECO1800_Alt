// Accounts, reports and submissions are shared JSON records on the Node server.
// Only the guest's radius and the separate route draft remain in browser storage.
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
  currentAccount = (await apiRequest('register', 'POST', { name, email, password })).user;
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
  currentAccount = (await apiRequest('preferences', 'PUT', preferences)).user;
}

export function getRadius() {
  const radius =
    currentAccount?.preferences.radius ??
    Number(localStorage.getItem('parkpal.radius') || 5000);
  return Number.isInteger(radius) && radius >= 1000 && radius <= 10000 && radius % 1000 === 0
    ? radius
    : 5000;
}

export async function saveRadius(radius) {
  if (currentAccount) await savePreferences({ ...currentAccount.preferences, radius });
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

export async function addReport(facility, category, description) {
  return (
    await apiRequest('reports', 'POST', {
      facilityId: facility.id,
      category,
      description,
    })
  ).report;
}

export async function resolveReport(id) {
  await apiRequest(`reports/${encodeURIComponent(id)}/resolve`, 'POST', {});
}
