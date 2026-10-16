// Shared timeline markup for Activity and individual facility details.
import { photoURL } from './photos.js';
import { escapeHTML, titleCase, formatDate, pageURL } from './helpers.js';

function photosHTML(photos = [], label = 'Report photo') {
  return `<div class="facility-photos">${photos
    .filter(photoURL)
    .map(
      (photo) =>
        `<a href="${photoURL(photo)}" target="_blank" rel="noopener"><img src="${photoURL(photo)}" alt="${label}" loading="lazy"></a>`,
    )
    .join('')}</div>`;
}
export function reportsHTML(reports, showFacilityName = true) {
  if (!reports.length)
    return '<p class="empty-state">No reports yet. Spot a problem? Add a report from a facility.</p>';
  return reports
    .map(
      (report) => `
    <article class="timeline-item ${report.resolvedAt ? 'resolved' : ''}">
      <span class="report-status">${escapeHTML(report.category)} · ${report.resolvedAt ? 'Resolved' : 'Open'}</span>
      ${showFacilityName ? `<h3>${escapeHTML(titleCase(report.facilityName))}</h3>` : ''}
      <p>${escapeHTML(report.description || 'No extra details provided.')}</p>
      <p class="report-meta">${escapeHTML(report.author)} · ${formatDate(report.createdAt)}</p>
      ${report.resolvedAt ? `<p class="report-meta">Resolved by ${escapeHTML(report.resolvedBy)} · ${formatDate(report.resolvedAt)}</p>` : ''}
      ${photosHTML(report.photos)}
      ${(report.resolutionHistory || []).length ? `<details><summary>Resolution history and proof</summary>${report.resolutionHistory.map((event) => `<p class="report-meta">${event.action === 'resolve' ? 'Resolved' : 'Reopened'} by ${escapeHTML(event.author)} · ${formatDate(event.createdAt)}</p>${photosHTML(event.photos, 'Resolution proof')}`).join('')}</details>` : ''}
      <div class="timeline-actions">
        ${!report.resolvedAt ? `<button class="text-button" data-resolve="${escapeHTML(report.id)}">Mark as resolved</button>` : `<button class="text-button" data-reopen="${escapeHTML(report.id)}">Not resolved — reopen report</button>`}
        ${showFacilityName ? `<a class="text-button" href="${pageURL(`index.html?lat=${report.lat}&lng=${report.lng}`)}">View on map ↗</a>` : ''}
      </div>
    </article>
  `,
    )
    .join('');
}
