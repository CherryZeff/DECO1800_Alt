// Facility details and problem reporting are shared by the two map pages.
import {
  find,
  icon,
  escapeHTML,
  titleCase,
  amenityNames,
  notify,
  handleForm,
  pageURL,
} from './helpers.js';
import { getReports, requireAccount, addReport, resolveReport } from './storage.js';
import { reportsHTML } from './reports.js';
import { addRouteStop, readRoute, saveRoute } from './route-state.js';

export function setupFacilityDetails(onReportsChanged, onAddStop) {
  let selectedFacility;
  const returnPage = location.pathname.endsWith('routes.html') ? 'routes.html' : 'index.html';

  function renderReports() {
    const reports = getReports(selectedFacility.id);
    // Keep older unresolved problems reachable, even after they leave the last ten.
    const recent = reports.slice(0, 10);
    const olderUnresolved = reports.slice(10).filter((report) => !report.resolvedAt);
    find('#detail-timeline').innerHTML = reportsHTML([...recent, ...olderUnresolved], false);
  }

  function open(facility) {
    selectedFacility = facility;
    const amenities = facility.amenities
      .map((key) => `<span class="tag">${escapeHTML(amenityNames[key])}</span>`)
      .join('');
    find('#facility-detail').innerHTML = `
      <div class="detail-type">${icon(facility.type)} ${facility.type === 'toilet' ? 'Public toilet' : 'Drinking water'}</div>
      <h2>${escapeHTML(titleCase(facility.name))}</h2>
      <p class="detail-address">${escapeHTML(titleCase(facility.address || 'Community map pin'))}</p>
      <div class="tag-list">${amenities}</div>
      ${amenities ? '' : '<p class="muted">No amenities confirmed in this record.</p>'}
      <h3>Opening hours</h3><p>${escapeHTML(facility.hours)}</p>
      ${facility.restrictions?.length ? `<p class="notice">${facility.restrictions.map(escapeHTML).join(' · ')}</p>` : ''}
      <p class="detail-description">${escapeHTML(facility.description)}</p>
      <p class="fine-print">${facility.source === 'Community' ? 'Local community contribution · unverified' : 'Source: Brisbane City Council'}</p>
      <div class="button-row">
        <button id="detail-add-stop" class="primary">${icon('plus')}Add to route</button>
        <button id="detail-directions" class="secondary">${icon('route')}Route here</button>
      </div>
      <button id="detail-report" class="text-button">Report a problem ↗</button>
      <section class="detail-activity">
        <h3>Facility reports</h3>
        <p class="fine-print">Last 10 reports, plus older unresolved problems. Saved on this browser.</p>
        <div id="detail-timeline" class="timeline"></div>
      </section>`;
    renderReports();

    find('#detail-add-stop').onclick = () => {
      try {
        addRouteStop(facility);
        find('#facility-dialog').close();
        if (onAddStop) onAddStop();
        else location.href = pageURL('routes.html');
      } catch (error) {
        notify(error.message);
      }
    };
    find('#detail-directions').onclick = () => {
      const route = readRoute();
      route.stops = [facility];
      route.roundTrip = false;
      saveRoute(route);
      location.href = pageURL('routes.html?build=1');
    };
    find('#detail-report').onclick = () => {
      if (!requireAccount(returnPage)) return;
      find('#facility-dialog').close();
      find('#report-form').reset();
      find('#report-form .form-error').textContent = '';
      find('#report-facility-name').textContent = titleCase(facility.name);
      find('#report-dialog').showModal();
    };
    if (!find('#facility-dialog').open) find('#facility-dialog').showModal();
  }

  handleForm(find('#report-form'), (form) => {
    addReport(selectedFacility, form.get('category'), form.get('description').trim());
    find('#report-dialog').close();
    onReportsChanged();
    open(selectedFacility);
    notify('Report saved on this browser.');
  });

  find('#facility-detail').addEventListener('click', (event) => {
    const button = event.target.closest('[data-resolve]');
    if (!button || !requireAccount(returnPage)) return;
    try {
      resolveReport(button.dataset.resolve);
      onReportsChanged();
      renderReports();
      notify('Problem marked as resolved.');
    } catch (error) {
      notify(error.message);
    }
  });

  return { open };
}
