import { find, notify, handleForm } from './helpers.js';
import {
  loadAccount,
  getAccount,
  getRadius,
  saveRadius,
  savePreferences,
  getPreferences,
} from './storage.js';

function radiusLabel() {
  const text = `${find('#account-radius').value} km`;
  find('#radius-value').textContent = text;
  find('#account-radius').setAttribute('aria-valuetext', text);
}
find('#account-radius').oninput = radiusLabel;
find('#dark-mode').checked = document.documentElement.dataset.theme === 'dark';
find('#dark-mode').onchange = (event) => {
  const theme = event.target.checked ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('parkpal.theme', theme);
  } catch {
    notify('Theme changed for this page, but browser storage is unavailable.');
  }
};
handleForm(find('#radius-form'), async (form) => {
  await saveRadius(Number(form.get('radius')) * 1000);
  notify('Radius saved. Return to the map to apply it.');
});
handleForm(find('#preferences-form'), async () => {
  const preferences = { ...getPreferences(), radius: getRadius() };
  document.querySelectorAll('#preferences-form input[type=checkbox]').forEach((input) => {
    preferences[input.name] = input.checked;
  });
  await savePreferences(preferences);
  notify('Facility preferences saved.');
});
async function start() {
  await loadAccount();
  find('#account-radius').value = getRadius() / 1000;
  radiusLabel();
  find('#radius-storage-note').textContent = getAccount()
    ? 'Saved with your account.'
    : 'Radius and facility preferences are saved on this browser until you sign in.';
  const preferences = getPreferences();
  document.querySelectorAll('#preferences-form input[type=checkbox]').forEach((input) => {
    input.checked = Boolean(preferences[input.name]);
  });
}
start().catch((error) => notify(error.message));
