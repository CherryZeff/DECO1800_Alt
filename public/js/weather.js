import { apiRequest } from './api.js';
import { brisbaneDate } from './facility-search.js';
const badge = document.querySelector('#weather-badge');
function conditions(code) {
  if (code === 0) return ['☀️', 'Clear'];
  if (code <= 2) return ['🌤️', 'Partly cloudy'];
  if (code === 3) return ['☁️', 'Cloudy'];
  if (code <= 48) return ['🌫️', 'Fog'];
  if (code >= 95) return ['⛈️', 'Thunderstorms'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return ['🌨️', 'Snow'];
  return ['🌧️', 'Rain or showers'];
}
let busy = false;
let shownDate;
async function refreshWeather() {
  if (!badge || busy) return;
  busy = true;
  if (shownDate && shownDate !== brisbaneDate().toISOString().slice(0, 10)) {
    badge.querySelector('.weather-temperature').textContent = '—';
    badge.setAttribute('aria-label', 'Loading today’s Brisbane forecast');
  }
  try {
    const { weather } = await apiRequest('weather');
    if (weather.date !== brisbaneDate().toISOString().slice(0, 10))
      throw new Error('Forecast date is out of date.');
    shownDate = weather.date;
    const [symbol, description] = conditions(weather.code);
    badge.querySelector('.weather-symbol').textContent = symbol;
    badge.querySelector('.weather-temperature').textContent =
      `${Math.round(weather.temperature)}°C`;
    const label = `Brisbane today: ${description}, maximum ${Math.round(weather.temperature)}°C. ${weather.source}.`;
    document.querySelector('#weather-source').textContent = weather.source;
    badge.title = label;
    badge.setAttribute('aria-label', label);
  } catch {
    badge.querySelector('.weather-symbol').textContent = '☁';
    badge.querySelector('.weather-temperature').textContent = '—';
    badge.title =
      'Today’s Brisbane forecast unavailable. Tap for the weather source.';
    badge.setAttribute('aria-label', badge.title);
  } finally {
    busy = false;
  }
}
refreshWeather();
setInterval(refreshWeather, 300000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshWeather();
});
