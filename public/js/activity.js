// Activity page: the newest ten reports shared by runners.
import { find, notify } from './helpers.js';
import { getReports, requireAccount, resolveReport, loadAccount } from './storage.js';
import { reportsHTML } from './reports.js';

async function renderActivity() {
  try {
    find('#activity-list').innerHTML = reportsHTML((await getReports()).slice(0, 10));
  } catch (error) {
    find('#activity-list').textContent = error.message;
  }
}

find('#refresh-activity').onclick = renderActivity;
find('#activity-list').onclick = async (event) => {
  const button = event.target.closest('[data-resolve]');
  if (!button || !requireAccount('activity.html')) return;
  try {
    button.disabled = true;
    await resolveReport(button.dataset.resolve);
    await renderActivity();
    notify('Problem marked as resolved.');
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
};
loadAccount()
  .then(renderActivity)
  .catch((error) => {
    find('#activity-list').textContent = error.message;
  });
