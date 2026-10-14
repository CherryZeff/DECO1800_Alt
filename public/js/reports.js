// Shared timeline markup for Activity and individual facility details.
import { escapeHTML, titleCase, formatDate, pageURL } from './helpers.js';

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
      <div class="timeline-actions">
        ${!report.resolvedAt ? `<button class="text-button" data-resolve="${report.id}">Mark as resolved</button>` : ''}
        ${showFacilityName ? `<a class="text-button" href="${pageURL(`index.html?lat=${report.lat}&lng=${report.lng}`)}">View on map ↗</a>` : ''}
      </div>
    </article>
  `,
    )
    .join('');
}
