// Account page: sign-in, profile editing and earlier contribution recovery.
import { find, notify, handleForm, setupDialogs, pageURL } from './helpers.js';
import { getAccount, registerAccount, signIn, updateAccount, loadAccount } from './storage.js';

import { oldBrowserRecords, importBrowserRecords, exportBrowserRecords } from './migration.js';

let mode = 'login';
setupDialogs();

function renderAccount() {
  const account = getAccount();
  find('#guest-account').hidden = Boolean(account);
  find('#member-account').hidden = !account;
  find('#browser-import').hidden = !account;
  const records = oldBrowserRecords();
  const count = records.submissions.length + records.reports.length;
  find('#export-browser').hidden = !count;
  find('#import-browser').disabled = !count;
  find('#import-status').textContent = count
    ? `${count} browser contributions available to import.`
    : 'No earlier contributions found on this browser address. You can import an export from your old Live Server address.';
  if (!account) return;
  find('#avatar-letter').textContent = account.name[0].toUpperCase();
  find('#profile-name').textContent = account.name;
  find('#profile-email').textContent = account.email;
  find('#profile-form [name=name]').value = account.name;
  find('#profile-form [name=email]').value = account.email;
}

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === 'register';
  find('#name-field').hidden = !registering;
  find('#name-field input').required = registering;
  find('#auth-title').textContent = registering ? 'Join ParkPal.' : 'Welcome back.';
  find('#auth-copy').textContent =
    'Sign in to share facilities and reports with other runners.';
  find('#auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  find('#toggle-auth').textContent = registering
    ? 'Already have an account? Sign in'
    : 'New here? Create an account';
  find('#auth-form [name=password]').autocomplete = registering
    ? 'new-password'
    : 'current-password';
  find('#auth-form .form-error').textContent = '';
}

find('#open-signin').onclick = () => {
  find('#auth-form').reset();
  setMode('login');
  find('#auth-dialog').showModal();
};
find('#toggle-auth').onclick = () => setMode(mode === 'login' ? 'register' : 'login');
handleForm(find('#auth-form'), async (form) => {
  if (mode === 'register')
    await registerAccount(form.get('name'), form.get('email'), form.get('password'));
  else await signIn(form.get('email'), form.get('password'));
  find('#auth-dialog').close();
  renderAccount();
  // Only allow returning to known app pages after signing in.
  const next = new URLSearchParams(location.search).get('next');
  if (
    [
      'index.html',
      'index.html?add=1',
      'routes.html',
      'activity.html',
      'favourites.html',
      'history.html',
    ].includes(next)
  ) {
    location.href = pageURL(next);
    return;
  }
  notify('You’re signed in on this browser.');
});
handleForm(find('#profile-form'), async (form) => {
  if (form.get('newPassword') !== form.get('confirmPassword'))
    throw new Error('New passwords do not match.');
  await updateAccount({
    name: form.get('name'),
    email: form.get('email'),
    currentPassword: form.get('currentPassword'),
    newPassword: form.get('newPassword'),
  });
  find('#profile-form').reset();
  renderAccount();
  notify('Account updated.');
});

async function importRecords(records) {
  find('#import-browser').disabled = true;
  find('#import-file').disabled = true;
  try {
    const count = await importBrowserRecords(records);
    find('#import-status').textContent =
      `${count} contributions imported. Repeating the import will not create duplicates.`;
    notify('Contributions saved on the server.');
  } catch (error) {
    find('#import-status').textContent = error.message;
  } finally {
    find('#import-browser').disabled = !oldBrowserRecords().email;
    find('#import-file').disabled = false;
  }
}
find('#import-browser').onclick = () => importRecords(oldBrowserRecords());
find('#export-browser').onclick = exportBrowserRecords;
find('#import-file').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose an export smaller than 5 MB.');
    await importRecords(JSON.parse(await file.text()));
  } catch (error) {
    find('#import-status').textContent = error.message;
  }
  event.target.value = '';
};
// Recovery exports remain available even when opened on the old Live Server address.
renderAccount();
loadAccount()
  .then(renderAccount)
  .catch((error) => notify(error.message));
