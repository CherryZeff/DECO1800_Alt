// BOM ACCESS-G model data via Open-Meteo, fixed to Brisbane and today's local date.
import { brisbaneDate } from '../public/js/facility-search.js';
let cached, pending;
export function normalizeWeather(
  payload,
  now = new Date(),
  source = 'BOM ACCESS-G via Open-Meteo',
) {
  const date = brisbaneDate(now).toISOString().slice(0, 10);
  const index = payload.daily?.time?.indexOf(date) ?? -1;
  const temperature = payload.daily?.temperature_2m_max?.[index];
  const code = payload.daily?.weather_code?.[index];
  if (
    index < 0 ||
    !Number.isFinite(temperature) ||
    !Number.isInteger(code) ||
    payload.daily_units?.temperature_2m_max !== '°C'
  )
    throw new Error('Today’s Brisbane forecast is unavailable.');
  return {
    date,
    temperature,
    code,
    location: 'Brisbane',
    source,
    fetchedAt: now.toISOString(),
  };
}
export async function getWeather() {
  const date = brisbaneDate().toISOString().slice(0, 10);
  if (cached?.date === date && Date.now() - Date.parse(cached.fetchedAt) < 1800000)
    return cached;
  if (pending) return pending;
  pending = (async () => {
    for (const provider of [
      { path: 'bom', source: 'BOM ACCESS-G via Open-Meteo' },
      { path: 'forecast', source: 'Open-Meteo (BOM model unavailable)' },
    ]) {
      try {
        const url = new URL(`https://api.open-meteo.com/v1/${provider.path}`);
        url.search = new URLSearchParams({
          latitude: '-27.4698',
          longitude: '153.0251',
          daily: 'weather_code,temperature_2m_max',
          timezone: 'Australia/Brisbane',
          forecast_days: '1',
          temperature_unit: 'celsius',
        });
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Weather service unavailable.');
        cached = normalizeWeather(
          await response.json(),
          new Date(),
          provider.source,
        );
        return cached;
      } catch {
        /* A missing model run can still have a valid general forecast. */
      }
    }
    throw new Error('Today’s Brisbane forecast is unavailable.');
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
