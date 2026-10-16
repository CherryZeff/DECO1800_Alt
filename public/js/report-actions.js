// One proof dialog and action flow shared by facility details and activity.
import { handleForm, notify } from './helpers.js';
import { requireAccount, resolveReport, reopenReport } from './storage.js';
import { readPhotos } from './photos.js';
export function setupReportActions(container, refresh, returnPage) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal proof-dialog';
  dialog.innerHTML = `<button type="button" class="close-dialog secondary">Cancel</button>
    <h2>Show the problem is resolved</h2>
    <form><label>Proof photos (required)<input name="proof" type="file" accept="image/jpeg,image/png,image/webp" multiple required /></label>
    <p>Upload a photo showing the repair or clean-up. Up to 3 photos, 2 MB each.</p>
    <p class="form-error" role="alert"></p><button type="submit" class="primary">Submit proof and resolve</button></form>`;
  document.body.append(dialog);
  dialog.querySelector('.close-dialog').onclick = () => dialog.close();
  let reportId;
  handleForm(dialog.querySelector('form'), async () => {
    const photos = await readPhotos(dialog.querySelector('[name=proof]'));
    if (!photos.length) throw new Error('Add a proof photo first.');
    await resolveReport(reportId, photos);
    dialog.close();
    await refresh();
    notify('Proof saved. Problem marked as resolved.');
  });
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-resolve], [data-reopen]');
    if (!button || !requireAccount(returnPage)) return;
    if (button.dataset.resolve) {
      reportId = button.dataset.resolve;
      dialog.querySelector('form').reset();
      dialog.querySelector('.form-error').textContent = '';
      dialog.showModal();
    } else {
      button.disabled = true;
      try {
        await reopenReport(button.dataset.reopen);
        await refresh();
        notify('Report reopened. The problem is marked as unresolved.');
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
      }
    }
  });
}
