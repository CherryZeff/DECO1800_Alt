import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'runstop-test-'));
process.env.DATA_DIR = directory;
const originalFetch = globalThis.fetch;
const externalCalls = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  if (url.hostname === 'data.brisbane.qld.gov.au') {
    externalCalls.push(url);
    const water = url.pathname.includes('fountain');
    const offset = Number(url.searchParams.get('offset') || 0);
    const result = water
      ? [
          {
            objectid: '1',
            park_name: 'TEST PARK',
            geo_point_2d: { lat: -27.47, lon: 153.025 },
            item_description: 'BUBBLER',
          },
        ]
      : offset === 0
        ? Array.from({ length: 100 }, (_, i) => ({
            facilityid: String(i),
            name: `Toilet ${i}`,
            geopoint: { lat: -27.47, lon: 153.026 },
            accessible: 'True',
          }))
        : [
            {
              facilityid: '100',
              name: 'Last page toilet',
              geopoint: { lat: -27.47, lon: 153.027 },
            },
          ];
    return Response.json({ total_count: water ? 1 : 101, results: result });
  }
  if (url.hostname === 'routing.openstreetmap.de') {
    assert.ok(url.pathname.startsWith('/routed-foot/route/v1/foot/'));
    return Response.json({
      code: 'Ok',
      routes: [
        {
          distance: 800,
          duration: 600,
          geometry: {
            type: 'LineString',
            coordinates: [
              [153.025, -27.47],
              [153.026, -27.471],
            ],
          },
          legs: [],
        },
      ],
      waypoints: [],
    });
  }
  return originalFetch(input, options);
};
const { server, normalize, distance } = await import('../server.js');
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie, facilityId, reportId;
async function request(path, method = 'GET', body, authenticated = false) {
  const response = await originalFetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  return { response, result };
}
after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((done) => server.close(done));
  rmSync(directory, { recursive: true, force: true });
});

test('serves the root entry point and its public assets', async () => {
  for (const path of ['/', '/index.html']) {
    const response = await originalFetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /src="\.\/public\/js\/index\.js"/);
  }
  for (const path of [
    '/public/routes.html',
    '/public/accounts.html',
    '/public/style.css',
    '/public/js/helpers.js',
    '/public/icons.svg',
  ]) {
    const response = await originalFetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
  }
});

test('normalization preserves unknown amenities and coordinate validity', () => {
  assert.equal(normalize({ geopoint: null }, 'toilet'), null);
  const row = normalize(
    {
      objectid: '5',
      park_name: 'PARK',
      item_description: 'DISABLED BUBBLER',
      geo_point_2d: { lat: -27.47, lon: 153.02 },
    },
    'water',
  );
  assert.deepEqual(row.amenities, []);
  assert.equal(row.id, 'water:5');
  assert.ok(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) > 111000);
});
test('guest can explore, queries are radius-filtered, and all council pages are loaded', async () => {
  const { response, result } = await request('/api/facilities?lat=-27.47&lng=153.025&radius=5000');
  assert.equal(response.status, 200);
  assert.equal(result.facilities.length, 102);
  assert.ok(externalCalls.every((url) => url.searchParams.get('where').includes('5000m')));
  assert.ok(externalCalls.some((url) => url.searchParams.get('offset') === '100'));
  assert.equal((await request('/api/facilities?lat=no&lng=153')).response.status, 400);
  assert.equal((await request('/api/facilities?lat=0&lng=0&radius=99999')).response.status, 400);
});
test('private files and guest mutations are blocked', async () => {
  for (const path of ['/data/accounts.json', '/server.js', '/%2e%2e/data/accounts.json'])
    assert.equal((await request(path)).response.status, 404);
  for (const path of ['/api/submissions', '/api/reports', '/api/reports/unknown/resolve'])
    assert.equal((await request(path, 'POST', {})).response.status, 401);
});
test('accounts persist hashed passwords; session response contains no credentials', async () => {
  const { response, result } = await request('/api/register', 'POST', {
    name: 'Test Runner',
    email: 'runner@example.com',
    password: 'test-password-123',
  });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
  assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal(result.user.name, 'Test Runner');
  assert.equal(result.user.hash, undefined);
  const stored = JSON.parse(readFileSync(join(directory, 'accounts.json')));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].password, undefined);
  assert.equal(stored[0].hash.length, 128);
  assert.equal(
    (
      await request('/api/register', 'POST', {
        name: 'Duplicate',
        email: 'RUNNER@example.com',
        password: 'another-password',
      })
    ).response.status,
    409,
  );
  assert.equal(
    (
      await request('/api/login', 'POST', {
        email: 'runner@example.com',
        password: 'wrong-password',
      })
    ).response.status,
    401,
  );
});
test('account preferences persist and are scoped to the session', async () => {
  const saved = await request(
    '/api/preferences',
    'PUT',
    { accessible: true, bottle: true, hideIssues: 'invalid' },
    true,
  );
  assert.equal(saved.result.user.preferences.accessible, true);
  assert.equal(saved.result.user.preferences.hideIssues, false);
  assert.equal(
    (await request('/api/me', 'GET', undefined, true)).result.user.preferences.bottle,
    true,
  );
  assert.equal((await request('/api/me')).result.user, null);
});
test('community pins save in JSON and appear only within the requested radius', async () => {
  const { response, result } = await request(
    '/api/submissions',
    'POST',
    {
      name: 'Test water',
      type: 'water',
      lat: -27.4701,
      lng: 153.025,
      amenities: ['bottle', 'invalid'],
      description: '',
    },
    true,
  );
  assert.equal(response.status, 201);
  facilityId = result.facility.id;
  assert.deepEqual(result.facility.amenities, ['bottle']);
  assert.equal(JSON.parse(readFileSync(join(directory, 'submissions.json'))).length, 1);
  const near = await request('/api/facilities?lat=-27.47&lng=153.025&radius=5000');
  assert.ok(near.result.facilities.some((row) => row.id === facilityId));
  const far = await request('/api/facilities?lat=0&lng=0&radius=5000');
  assert.ok(!far.result.facilities.some((row) => row.id === facilityId));
  assert.equal(
    (
      await request(
        '/api/submissions',
        'POST',
        { name: 'Bad pin', type: 'water', lat: 999, lng: 0 },
        true,
      )
    ).response.status,
    400,
  );
});
test('reports can be created, inspected and resolved idempotently', async () => {
  const created = await request(
    '/api/reports',
    'POST',
    { facilityId, category: 'Broken', description: 'No water' },
    true,
  );
  assert.equal(created.response.status, 201);
  reportId = created.result.report.id;
  const before = await request(`/api/reports?facility=${encodeURIComponent(facilityId)}`);
  assert.equal(before.result.unresolved.length, 1);
  const resolved = await request(`/api/reports/${reportId}/resolve`, 'POST', {}, true);
  assert.ok(resolved.result.report.resolvedAt);
  const again = await request(`/api/reports/${reportId}/resolve`, 'POST', {}, true);
  assert.equal(again.result.report.resolvedAt, resolved.result.report.resolvedAt);
  assert.equal(
    (await request(`/api/reports?facility=${encodeURIComponent(facilityId)}`)).result.unresolved
      .length,
    0,
  );
  assert.equal(
    (await request('/api/reports', 'POST', { facilityId: 'made-up', category: 'Broken' }, true))
      .response.status,
    404,
  );
});
test('timeline returns ten latest reports and retains older unresolved problems', async () => {
  for (let i = 0; i < 12; i++)
    await request(
      '/api/reports',
      'POST',
      { facilityId, category: 'Dirty', description: `Problem ${i}` },
      true,
    );
  const result = (await request(`/api/reports?facility=${encodeURIComponent(facilityId)}`)).result;
  assert.equal(result.reports.length, 10);
  assert.equal(result.unresolved.length, 12);
  assert.equal(result.reports[0].description, 'Problem 11');
  assert.equal(JSON.parse(readFileSync(join(directory, 'reports.json'))).length, 13);
});
test('guests can request foot routes, with bounded and validated coordinates', async () => {
  const route = await request('/api/route', 'POST', {
    points: [
      { lat: -27.47, lng: 153.025 },
      { lat: -27.471, lng: 153.026 },
    ],
  });
  assert.equal(route.response.status, 200);
  assert.equal(route.result.route.distance, 800);
  assert.equal(
    (await request('/api/route', 'POST', { points: [{ lat: 0, lng: 0 }] })).response.status,
    400,
  );
  assert.equal(
    (
      await request('/api/route', 'POST', {
        points: [
          { lat: 0, lng: 0 },
          { lat: 100, lng: 0 },
        ],
      })
    ).response.status,
    400,
  );
});
test('cross-origin writes are rejected and logout invalidates the session', async () => {
  const blocked = await originalFetch(`${base}/api/preferences`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://elsewhere.example',
      Cookie: cookie,
    },
    body: '{}',
  });
  assert.equal(blocked.status, 403);
  assert.equal((await request('/api/logout', 'POST', {}, true)).response.status, 200);
  assert.equal((await request('/api/me', 'GET', undefined, true)).result.user, null);
  const login = await request('/api/login', 'POST', {
    email: 'runner@example.com',
    password: 'test-password-123',
  });
  assert.equal(login.response.status, 200);
});
