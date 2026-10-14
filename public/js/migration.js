// Optional recovery from the previous browser-only version. Passwords are never exported.
import { apiRequest } from './api.js';
import { getAccount } from './storage.js';

export function oldBrowserRecords() {
  const empty = { email: '', submissions: [], reports: [] };
  try {
    const accounts = JSON.parse(localStorage.getItem('parkpal.accounts') || '[]');
    const current = getAccount();
    const signedIn = JSON.parse(localStorage.getItem('parkpal.signedInAccount') || 'null');
    const oldAccount = accounts.find((item) =>
      current
        ? item.email.toLowerCase() === current.email.toLowerCase()
        : item.id === signedIn,
    );
    if (!oldAccount) return empty;
    const owned = (name) =>
      JSON.parse(localStorage.getItem(`parkpal.${name}`) || '[]').filter(
        (item) => item.userId === oldAccount.id,
      );
    return {
      email: oldAccount.email,
      submissions: owned('submissions'),
      reports: owned('reports'),
    };
  } catch {
    return empty;
  }
}

export function exportBrowserRecords() {
  const records = oldBrowserRecords();
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'parkpal-browser-contributions.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importBrowserRecords(records = oldBrowserRecords()) {
  if (!getAccount() || records?.email?.toLowerCase() !== getAccount().email.toLowerCase())
    throw new Error('Sign in with the email used for these browser contributions.');
  if (
    !Array.isArray(records.submissions) ||
    !Array.isArray(records.reports) ||
    records.submissions.length + records.reports.length > 1000
  )
    throw new Error('Invalid contribution export.');
  const idMap = new Map();
  // clientId makes retries safe if a previous import stopped part way through.
  for (const facility of records.submissions) {
    const result = await apiRequest('submissions', 'POST', {
      ...facility,
      photos: [],
      clientId: facility.id,
    });
    idMap.set(facility.id, result.facility.id);
  }
  for (const report of records.reports) {
    const result = await apiRequest('reports', 'POST', {
      facilityId: idMap.get(report.facilityId) || report.facilityId,
      category: report.category,
      description: report.description,
      clientId: report.id,
    });
    if (report.resolvedAt) await apiRequest(`reports/${result.report.id}/resolve`, 'POST', {});
  }
  return records.submissions.length + records.reports.length;
}
