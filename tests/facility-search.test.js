import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openingStatus,
  parseFacilitySearch,
  matchesFacilitySearch,
} from '../public/js/facility-search.js';
import { normalizeWeather } from '../lib/weather.js';
const fridayNoon = new Date('2026-10-16T02:00:00Z');
test('opening hours use Brisbane time, ranges, day overrides, overnight intervals and unknowns', () => {
  for (const hours of [
    '24/7',
    'Open 24 hours',
    'Mo-Fr 09:00-17:00',
    'Mon-Fri 9am-5pm',
    'Daily 06:00-18:00',
    'Mo-Su 00:00-24:00',
  ])
    assert.equal(openingStatus(hours, fridayNoon), 'open', hours);
  for (const hours of [
    'Mo-Fr 13:00-17:00',
    'Sa-Su 09:00-17:00',
    'Mo-Su 09:00-17:00; Fr off',
  ])
    assert.equal(openingStatus(hours, fridayNoon), 'closed', hours);
  assert.equal(
    openingStatus('Fr 22:00-02:00', new Date('2026-10-16T15:00:00Z')),
    'open',
  );
  assert.equal(
    openingStatus('Fr 22:00-02:00', new Date('2026-10-16T16:00:00Z')),
    'closed',
  );
  assert.equal(openingStatus('Mo-Fr 09:00-12:00,13:00-17:00', fridayNoon), 'closed');
  for (const hours of [
    '',
    'Opening hours not recorded',
    'Sunrise to sunset',
    'Mo-Fr 09:00-17:00; PH off',
    'By appointment',
    'Mo 99:00-17:00',
  ])
    assert.equal(openingStatus(hours, fridayNoon), 'unknown', hours);
});
test('facility phrases select known attributes without confusing female with male or named places', () => {
  const female = parseFacilitySearch('closest female toilets');
  assert.equal(female.female, true);
  assert.equal(female.male, false);
  assert.equal(parseFacilitySearch('male toilets').male, true);
  assert.equal(parseFacilitySearch('dog fountains').dog, true);
  assert.equal(parseFacilitySearch('Open toilets').open, true);
  assert.equal(parseFacilitySearch('West End'), null);
  assert.equal(parseFacilitySearch('Corner Store'), null);
  const facility = {
    type: 'toilet',
    amenities: [],
    hours: '24/7',
    toiletDetails: { female: true },
  };
  assert.equal(matchesFacilitySearch(facility, female), true);
  assert.equal(
    matchesFacilitySearch(facility, parseFacilitySearch('male toilets')),
    false,
  );
  assert.equal(
    matchesFacilitySearch(
      { ...facility, hours: '' },
      parseFacilitySearch('open toilets'),
    ),
    false,
  );
});
test('weather accepts only today in Brisbane with valid Celsius values', () => {
  const payload = {
    daily: { time: ['2026-10-16'], temperature_2m_max: [28], weather_code: [2] },
    daily_units: { temperature_2m_max: '°C' },
  };
  assert.equal(
    normalizeWeather(payload, new Date('2026-10-15T15:00:00Z')).temperature,
    28,
  );
  assert.throws(() => normalizeWeather(payload, new Date('2026-10-16T15:00:00Z')));
  assert.throws(() =>
    normalizeWeather(
      { ...payload, daily_units: { temperature_2m_max: '°F' } },
      fridayNoon,
    ),
  );
  assert.throws(() =>
    normalizeWeather(
      { ...payload, daily: { ...payload.daily, temperature_2m_max: [null] } },
      fridayNoon,
    ),
  );
});

test('weather falls back when BOM model values are missing and caches only a valid current-day result', async () => {
  const { getWeather } = await import('../lib/weather.js');
  const previousFetch = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url.pathname);
    const date = new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 10);
    return Response.json({
      daily: {
        time: [date],
        temperature_2m_max: [url.pathname === '/v1/bom' ? null : 25],
        weather_code: [2],
      },
      daily_units: { temperature_2m_max: '°C' },
    });
  };
  try {
    const weather = await getWeather();
    assert.equal(weather.temperature, 25);
    assert.equal(weather.source, 'Open-Meteo (BOM model unavailable)');
    await getWeather();
    assert.deepEqual(calls, ['/v1/bom', '/v1/forecast']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
