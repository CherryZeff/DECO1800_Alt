// Activity page: the newest ten reports saved in this browser.
import { find, notify } from './helpers.js';
import { getReports, requireAccount, resolveReport } from './storage.js';
import { reportsHTML } from './reports.js';

function renderActivity() {
  try {
    find('#activity-list').innerHTML = reportsHTML(getReports().slice(0, 10));
  } catch (error) {
    find('#activity-list').textContent = error.message;
  }
}

find('#refresh-activity').onclick = renderActivity;
find('#activity-list').onclick = (event) => {
  const button = event.target.closest('[data-resolve]');
  if (!button || !requireAccount('activity.html')) return;
  try {
    resolveReport(button.dataset.resolve);
    renderActivity();
    notify('Problem marked as resolved.');
  } catch (error) {
    notify(error.message);
  }
};
renderActivity();
