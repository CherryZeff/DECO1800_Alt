// Account page: local sign-in and personal facility preferences.
import { find, notify, handleForm, setupDialogs, pageURL } from './helpers.js';
import { getAccount, registerAccount, signIn, signOut, savePreferences } from './storage.js';

let mode = 'login';
setupDialogs();

function renderAccount() {
  const account = getAccount();
  find('#guest-account').hidden = Boolean(account);
  find('#member-account').hidden = !account;
  if (!account) return;
  find('#avatar-letter').textContent = account.name[0].toUpperCase();
  find('#profile-name').textContent = account.name;
  find('#profile-email').textContent = account.email;
  document.querySelectorAll('#preferences-form input').forEach((input) => {
    input.checked = Boolean(account.preferences[input.name]);
  });
}

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === 'register';
  find('#name-field').hidden = !registering;
  find('#name-field input').required = registering;
  find('#auth-title').textContent = registering ? 'Join ParkPal.' : 'Welcome back.';
  find('#auth-copy').textContent =
    'This account is saved on this browser only. Use a demo password.';
  find('#auth-submit').textContent = registering ? 'Create local account' : 'Sign in';
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
  if (['index.html', 'index.html?add=1', 'routes.html', 'activity.html'].includes(next)) {
    location.href = pageURL(next);
    return;
  }
  notify('You’re signed in on this browser.');
});
handleForm(find('#preferences-form'), () => {
  const preferences = {};
  document.querySelectorAll('#preferences-form input').forEach((input) => {
    preferences[input.name] = input.checked;
  });
  savePreferences(preferences);
  notify('Preferences saved. They apply when you return to the map.');
});
find('#logout').onclick = () => {
  try {
    signOut();
    renderAccount();
    notify('Signed out.');
  } catch (error) {
    notify(error.message);
  }
};

try {
  renderAccount();
} catch (error) {
  notify(error.message);
}
