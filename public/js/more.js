import { find, notify } from './helpers.js';
import { loadAccount, signOut } from './storage.js';

async function render() {
  const account = await loadAccount();
  find('#more-profile').textContent = account
    ? `Signed in as ${account.name}`
    : 'Explore freely, or sign in to save your runs and places.';
  find('#logout').hidden = !account;
}
find('#logout').onclick = async () => {
  find('#logout').disabled = true;
  try {
    await signOut();
    await render();
    notify('Signed out.');
  } catch (error) {
    notify(error.message);
  } finally {
    find('#logout').disabled = false;
  }
};
render().catch((error) => notify(error.message));
