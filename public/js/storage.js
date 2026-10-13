// Browser-only prototype storage. Nothing here writes to the project JSON files.
// These local accounts demonstrate the flow; they are not secure server authentication.
import { pageURL } from './helpers.js';
const prefix = 'parkpal.';

export function readSaved(name, fallback) {
  try {
    const value = localStorage.getItem(prefix + name);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    throw new Error('Browser storage could not be read. Check your browser settings.');
  }
}

export function save(name, value) {
  try {
    localStorage.setItem(prefix + name, JSON.stringify(value));
  } catch {
    throw new Error('Could not save on this browser. Storage may be full or blocked.');
  }
}

export function getAccount() {
  const id = readSaved('signedInAccount', null);
  return readSaved('accounts', []).find((account) => account.id === id) || null;
}

export function requireAccount(returnPage = 'index.html') {
  const account = getAccount();
  if (!account) {
    window.location.href = pageURL(`accounts.html?next=${encodeURIComponent(returnPage)}`);
    return null;
  }
  return account;
}

// Web Crypto avoids saving a plain-text password, even for this local demo.
async function passwordHash(password, salt) {
  if (!crypto.subtle) throw new Error('Account setup requires localhost or HTTPS.');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function registerAccount(name, email, password) {
  if (!name.trim()) throw new Error('Please enter your name.');
  if (password.length < 8) throw new Error('Use at least 8 characters for the password.');
  const normalEmail = email.trim().toLowerCase();
  const salt = crypto.randomUUID();
  const hash = await passwordHash(password, salt);
  const accounts = readSaved('accounts', []);
  if (accounts.some((account) => account.email === normalEmail)) {
    throw new Error('This browser already has an account with that email.');
  }
  const account = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: normalEmail,
    salt,
    hash,
    preferences: {},
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  save('accounts', accounts);
  save('signedInAccount', account.id);
  return account;
}

export async function signIn(email, password) {
  const account = readSaved('accounts', []).find(
    (item) => item.email === email.trim().toLowerCase(),
  );
  if (!account || (await passwordHash(password, account.salt)) !== account.hash) {
    throw new Error('Email or password is incorrect for this browser.');
  }
  save('signedInAccount', account.id);
  return account;
}

export function signOut() {
  save('signedInAccount', null);
}

export function savePreferences(preferences) {
  const account = getAccount();
  if (!account) throw new Error('Sign in to save preferences.');
  const accounts = readSaved('accounts', []);
  accounts.find((item) => item.id === account.id).preferences = preferences;
  save('accounts', accounts);
}

export function addFacility(input) {
  const account = getAccount();
  if (!account) throw new Error('Sign in to add a facility.');
  const facility = {
    ...input,
    id: `community:${crypto.randomUUID()}`,
    source: 'Community',
    author: account.name,
    userId: account.id,
    createdAt: new Date().toISOString(),
    address: '',
    restrictions: [],
    openReports: 0,
  };
  const submissions = readSaved('submissions', []);
  submissions.push(facility);
  save('submissions', submissions);
  return facility;
}

export function getReports(facilityId) {
  return readSaved('reports', [])
    .filter((report) => !facilityId || report.facilityId === facilityId)
    .reverse()
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

export function addReport(facility, category, description) {
  const account = getAccount();
  if (!account) throw new Error('Sign in to report a problem.');
  const report = {
    id: crypto.randomUUID(),
    facilityId: facility.id,
    facilityName: facility.name,
    facilityType: facility.type,
    lat: facility.lat,
    lng: facility.lng,
    category,
    description,
    author: account.name,
    userId: account.id,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };
  const reports = readSaved('reports', []);
  reports.push(report);
  save('reports', reports);
  return report;
}

export function resolveReport(id) {
  const account = getAccount();
  if (!account) throw new Error('Sign in to resolve a report.');
  const reports = readSaved('reports', []);
  const report = reports.find((item) => item.id === id);
  if (!report) throw new Error('Report not found.');
  if (!report.resolvedAt) {
    report.resolvedAt = new Date().toISOString();
    report.resolvedBy = account.name;
    save('reports', reports);
  }
}
