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
import {
  getReports,
  requireAccount,
  addReport,
  resolveReport,
  getAccount,
  getFavourites,
  setFavourite,
  markVisited,
} from './storage.js';
import { reportsHTML } from './reports.js';
import { addRouteStop, readRoute, saveRoute } from './route-state.js';
import { photoURL } from './photos.js';

export function setupFacilityDetails(onReportsChanged, onAddStop) {
  let selectedFacility;
  let reportRequest = 0;
  let favouriteRequest = 0;
  const returnPage = location.pathname.endsWith('routes.html')
    ? 'routes.html'
    : 'index.html';

  async function renderReports() {
    const request = ++reportRequest;
    find('#detail-timeline').textContent = 'Loading reports…';
    let reports;
    try {
      reports = await getReports(selectedFacility.id);
    } catch (error) {
      if (request === reportRequest)
        find('#detail-timeline').textContent = error.message;
      return;
    }
    if (request !== reportRequest) return;
    // Keep older unresolved problems reachable, even after they leave the last ten.
    const recent = reports.slice(0, 10);
    const olderUnresolved = reports.slice(10).filter((report) => !report.resolvedAt);
    find('#detail-timeline').innerHTML = reportsHTML(
      [...recent, ...olderUnresolved],
      false,
    );
  }

  function open(facility) {
    selectedFacility = facility;
    const amenities = facility.amenities
      .map((key) => `<span class="tag">${escapeHTML(amenityNames[key])}</span>`)
      .join('');
    const toilet = facility.toiletDetails || {};
    const types = [];
    if (toilet.male && toilet.female) types.push('Male / Female');
    else if (toilet.male) types.push('Male');
    else if (toilet.female) types.push('Female');
    if (toilet.unisex || facility.amenities.includes('unisex')) types.push('Unisex');
    if (toilet.allgender) types.push('Gender-neutral (all-gender)');
    find('#facility-detail').innerHTML = `
      <div class="detail-type">${icon(facility.type)} ${facility.type === 'toilet' ? 'Public toilet' : facility.type === 'store' ? 'Convenience store' : 'Drinking water'}</div>
      <h2>${escapeHTML(titleCase(facility.name))}</h2>
      <p class="detail-address">${escapeHTML(titleCase(facility.address || 'Community map pin'))}</p>
      <div class="tag-list">${amenities}</div>
      ${amenities ? '' : '<p class="muted">No amenities confirmed in this record.</p>'}
      ${facility.type === 'toilet' ? `<dl class="toilet-details"><div><dt>Toilet types</dt><dd>${types.join(' · ') || 'Not recorded'}</dd></div><div><dt>Showers</dt><dd>${toilet.shower === true ? 'Yes' : toilet.shower === false ? 'No' : 'Not recorded'}</dd></div></dl>` : ''}
      <h3>Opening hours</h3><p>${escapeHTML(facility.hours)}</p>
      ${facility.restrictions?.length ? `<p class="notice">${facility.restrictions.map(escapeHTML).join(' · ')}</p>` : ''}
      <p class="detail-description">${escapeHTML(facility.description)}</p>
      <div class="facility-photos">${(facility.photos || [])
        .filter((filename) => photoURL(filename))
        .map(
          (filename) =>
            `<a href="${photoURL(filename)}" target="_blank" rel="noopener"><img src="${photoURL(filename)}" alt="Photo of ${escapeHTML(facility.name)}" loading="lazy"></a>`,
        )
        .join('')}</div>
      <p class="fine-print">${facility.source === 'Community' ? 'Community contribution · unverified' : `Source: ${escapeHTML(facility.source || 'Brisbane City Council')}`}</p>
      <div class="button-row">
        <button id="detail-add-stop" class="primary">${icon('plus')}Add to route</button>
        <button id="detail-directions" class="secondary">${icon('route')}Route here</button>
      </div>
      <div class="button-row"><button id="detail-favourite" class="secondary" aria-pressed="false">☆ Favourite</button><button id="detail-visited" class="secondary">Mark as visited</button></div>
      <p id="detail-personal-status" role="status" class="fine-print"></p>
      <button id="detail-report" class="text-button">Report a problem ↗</button>
      <section class="detail-activity">
        <h3>Facility reports</h3>
        <p class="fine-print">Last 10 reports, plus older unresolved problems. Shared with all runners.</p>
        <div id="detail-timeline" class="timeline"></div>
      </section>`;
    renderReports();
    const current = ++favouriteRequest;
    let saved = false;
    const favouriteButton = find('#detail-favourite');
    const showFavourite = () => {
      favouriteButton.textContent = saved ? '★ Favourited' : '☆ Favourite';
      favouriteButton.setAttribute('aria-pressed', String(saved));
    };
    if (getAccount()) {
      favouriteButton.disabled = true;
      getFavourites()
        .then((rows) => {
          if (current !== favouriteRequest) return;
          saved = rows.some((row) => row.facility.id === facility.id);
          showFavourite();
        })
        .catch((error) => {
          if (current === favouriteRequest)
            find('#detail-personal-status').textContent = error.message;
        })
        .finally(() => {
          if (current === favouriteRequest) favouriteButton.disabled = false;
        });
    }
    favouriteButton.onclick = async () => {
      if (!requireAccount(returnPage)) return;
      favouriteButton.disabled = true;
      try {
        await setFavourite(facility.id, !saved);
        saved = !saved;
        showFavourite();
        notify(saved ? 'Added to favourites.' : 'Removed from favourites.');
      } catch (error) {
        notify(error.message);
      } finally {
        favouriteButton.disabled = false;
      }
    };
    find('#detail-visited').onclick = async (event) => {
      if (!requireAccount(returnPage)) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await markVisited(facility.id);
        if (current === favouriteRequest)
          find('#detail-personal-status').textContent =
            'Visit recorded. Reports for this facility appear in your activity.';
        notify('Visit recorded.');
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
      }
    };

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
      location.href = pageURL(
        `routes.html?build=1${document.body.classList.contains('nearest-mode') ? '&nearest=1' : ''}`,
      );
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

  handleForm(find('#report-form'), async (form) => {
    await addReport(
      selectedFacility,
      form.get('category'),
      form.get('description').trim(),
    );
    find('#report-dialog').close();
    await onReportsChanged();
    open(selectedFacility);
    notify('Report saved and shared.');
  });

  find('#facility-detail').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-resolve]');
    if (!button || !requireAccount(returnPage)) return;
    try {
      button.disabled = true;
      await resolveReport(button.dataset.resolve);
      await onReportsChanged();
      await renderReports();
      notify('Problem marked as resolved.');
    } catch (error) {
      notify(error.message);
    } finally {
      button.disabled = false;
    }
  });

  return { open };
}
