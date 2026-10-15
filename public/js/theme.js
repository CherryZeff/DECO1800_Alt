// This small script runs before paint on every page to avoid a light flash.
try {
  document.documentElement.dataset.theme =
    localStorage.getItem('parkpal.theme') === 'dark' ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}
