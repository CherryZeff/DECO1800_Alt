import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'runstop-test-'));
process.env.DATA_DIR = directory;
const proofPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
const originalFetch = globalThis.fetch;
const externalCalls = [];
let routingModes = ['walking'];
let geocoderCalls = 0;
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  if (url.hostname === 'api.open-meteo.com') {
    assert.equal(url.pathname, '/v1/bom');
    assert.equal(url.searchParams.get('forecast_days'), '1');
    const date = new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 10);
    return Response.json({ daily: { time: [date], temperature_2m_max: [29], weather_code: [2] }, daily_units: { temperature_2m_max: '°C' } });
  }
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
  if (url.hostname === 'nominatim.openstreetmap.org') {
    geocoderCalls++;
    assert.equal(url.searchParams.get('countrycodes'), 'au');
    assert.equal(url.searchParams.get('bounded'), '1');
    return Response.json([
      { display_name: 'West End, Brisbane, Queensland', lat: '-27.48', lon: '153.01' },
    ]);
  }
  if (url.hostname === 'routing.openstreetmap.de') {
    assert.ok(url.pathname.startsWith('/routed-foot/route/v1/foot/'));
    assert.equal(url.searchParams.get('alternatives'), 'true');
    const pointCount = url.pathname.split('/').at(-1).split(';').length;
    return Response.json({
      code: 'Ok',
      routes: routingModes.map((mode) => ({
        distance: 800,
        duration: 600,
        geometry: {
          type: 'LineString',
          coordinates: [
            [153.025, -27.47],
            [153.026, -27.471],
          ],
        },
        legs: Array.from({ length: pointCount - 1 }, () => ({
          steps: [
            {
              mode,
              distance: 800,
              name: 'Footpath',
              maneuver: {
                type: 'depart',
                bearing_after: 90,
                location: [153.025, -27.47],
              },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [153.025, -27.47],
                  [153.026, -27.471],
                ],
              },
              intersections: [
                {
                  location: [153.025, -27.47],
                  bearings: [90, 180],
                  entry: [true, true],
                },
              ],
            },
          ],
        })),
      })),
      waypoints: [
        { distance: 40, location: [153.025, -27.47], hint: 'unused-provider-hint' },
      ],
    });
  }
  return originalFetch(input, options);
};
const {
  server,
  normalize,
  distance,
  isWalkingOnly,
  serializeRoutes,
  migrateSavedRoutes,
} = await import('../server.js');
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie, facilityId, reportId;
async function request(path, method = 'GET', body, authenticated = false) {
  const response = await originalFetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authenticated ? { Cookie: cookie } : {}),
    },
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

test('route migration keeps original points and ownership, backs up originals, and is repeatable', () => {
  const migrationDir = mkdtempSync(join(tmpdir(), 'parkpal-route-migration-'));
  try {
    const coordinates = Array.from({ length: 300 }, (_, index) => [
      153 + index / 100000,
      -27.47,
    ]);
    const step = {
      distance: 800,
      duration: 600,
      name: 'Footpath',
      mode: 'walking',
      maneuver: {
        type: 'turn',
        modifier: 'left',
        location: coordinates[0],
        bearing_before: 90,
      },
      geometry: { type: 'LineString', coordinates },
      intersections: coordinates.map((location) => ({
        location,
        bearings: [90, 180],
        entry: [true, true],
      })),
    };
    const record = {
      id: 'saved-route',
      userId: 'owner',
      createdAt: '2026-10-14T00:00:00.000Z',
      name: 'Morning run',
      draft: {
        origin: { lat: -27.47, lng: 153 },
        originLabel: 'Original start',
        stops: [
          { lat: -27.47, lng: 153.001, name: 'Point 1' },
          { lat: -27.47, lng: 153.003, name: 'Toilet', id: 'toilet:1' },
        ],
        roundTrip: false,
      },
      route: {
        geometry: { type: 'LineString', coordinates },
        distance: 800,
        duration: 600,
        weight: 650,
        legs: [{ steps: [step], summary: 'Footpath', distance: 800, duration: 600 }],
        waypoints: [{ distance: 40, hint: 'provider-only', location: coordinates[0] }],
      },
    };
    const records = [
      record,
      {
        ...record,
        id: 'another-route',
        userId: 'another-owner',
        draft: { ...record.draft, roundTrip: true },
        route: {
          geometry: record.route.geometry,
          legs: [
            {
              steps: [
                {
                  distance: 800,
                  name: 'Footpath',
                  mode: 'walking',
                  maneuver: { type: 'depart' },
                },
              ],
            },
          ],
        },
      },
    ];
    const original = JSON.stringify(records, null, 2) + '\n';
    const file = join(migrationDir, 'routes.json');
    writeFileSync(file, original);
    const backup = migrateSavedRoutes(migrationDir);
    assert.equal(readFileSync(backup, 'utf8'), original);
    const contents = readFileSync(file, 'utf8');
    const saved = JSON.parse(contents);
    assert.ok(Buffer.byteLength(contents) < Buffer.byteLength(original) / 4);
    for (const [index, row] of saved.entries()) {
      const originalRecord = records[index];
      assert.deepEqual(row, {
        id: originalRecord.id,
        userId: originalRecord.userId,
        createdAt: originalRecord.createdAt,
        draft: originalRecord.draft,
      });
      assert.equal(row.route, undefined);
    }
    assert.equal(serializeRoutes(saved), contents);
    assert.equal(migrateSavedRoutes(migrationDir), null);
    assert.equal(readdirSync(migrationDir).length, 2);
    // A malformed file must never be overwritten by the migration.
    writeFileSync(file, '{unfinished');
    assert.throws(() => migrateSavedRoutes(migrationDir));
    assert.equal(readFileSync(file, 'utf8'), '{unfinished');
  } finally {
    rmSync(migrationDir, { recursive: true, force: true });
  }
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
    '/public/more.html',
    '/public/settings.html',
    '/public/history.html',
    '/public/favourites.html',
    '/public/js/theme.js',
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
  const { response, result } = await request(
    '/api/facilities?lat=-27.47&lng=153.025&radius=5000',
  );
  assert.equal(response.status, 200);
  assert.equal(result.facilities.length, 102);
  assert.ok(
    externalCalls.every((url) => url.searchParams.get('where').includes('5000m')),
  );
  assert.ok(externalCalls.some((url) => url.searchParams.get('offset') === '100'));
  assert.equal((await request('/api/facilities?lat=no&lng=153')).response.status, 400);
  assert.equal(
    (await request('/api/facilities?lat=0&lng=0&radius=99999')).response.status,
    400,
  );
});
test('private files and guest mutations are blocked', async () => {
  for (const path of [
    '/data/accounts.json',
    '/server.js',
    '/%2e%2e/data/accounts.json',
  ])
    assert.equal((await request(path)).response.status, 404);
  for (const path of [
    '/api/submissions',
    '/api/reports',
    '/api/reports/unknown/resolve',
  ])
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
  const before = await request(
    `/api/reports?facility=${encodeURIComponent(facilityId)}`,
  );
  assert.equal(before.result.unresolved.length, 1);
  const resolved = await request(`/api/reports/${reportId}/resolve`, 'POST', { photos: [proofPhoto] }, true);
  assert.ok(resolved.result.report.resolvedAt);
  const again = await request(`/api/reports/${reportId}/resolve`, 'POST', {}, true);
  assert.equal(again.result.report.resolvedAt, resolved.result.report.resolvedAt);
  assert.equal(
    (await request(`/api/reports?facility=${encodeURIComponent(facilityId)}`)).result
      .unresolved.length,
    0,
  );
  assert.equal(
    (
      await request(
        '/api/reports',
        'POST',
        { facilityId: 'made-up', category: 'Broken' },
        true,
      )
    ).response.status,
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
  const result = (
    await request(`/api/reports?facility=${encodeURIComponent(facilityId)}`)
  ).result;
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
    (await request('/api/route', 'POST', { points: [{ lat: 0, lng: 0 }] })).response
      .status,
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

test('radius defaults to 5 km and persists valid slider values', async () => {
  const login = await request('/api/login', 'POST', {
    email: 'runner@example.com',
    password: 'test-password-123',
  });
  cookie = login.response.headers.get('set-cookie').split(';')[0];
  assert.equal(login.result.user.preferences.radius, 5000);
  const changed = await request(
    '/api/preferences',
    'PUT',
    { radius: 7000, accessible: true },
    true,
  );
  assert.equal(changed.result.user.preferences.radius, 7000);
  const saved = JSON.parse(readFileSync(join(directory, 'accounts.json')))[0];
  assert.equal(saved.preferences.radius, 7000);
  assert.equal(
    (await request('/api/me', 'GET', undefined, true)).result.user.preferences.radius,
    7000,
  );
  for (const radius of [0, 11000, 5500, '7000']) {
    assert.equal(
      (await request('/api/preferences', 'PUT', { radius }, true)).response.status,
      400,
    );
  }
  assert.equal(
    (await request('/api/facilities?lat=-27.47&lng=153.025&radius=7000')).response
      .status,
    200,
  );
  assert.ok(
    externalCalls.some((url) => url.searchParams.get('where').includes('7000m')),
  );
});

test('photo submissions persist files, reload after council records, and reject invalid uploads', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
  const input = {
    name: 'Photo toilet',
    type: 'toilet',
    lat: -27.47,
    lng: 153.025,
    photos: [`data:image/png;base64,${png}`],
  };
  const created = await request('/api/submissions', 'POST', input, true);
  assert.equal(created.response.status, 201);
  const photo = created.result.facility.photos[0];
  assert.match(photo, /^[a-f0-9-]{36}\.png$/);
  assert.deepEqual(
    readFileSync(join(directory, 'photos', photo)),
    Buffer.from(png, 'base64'),
  );
  const image = await originalFetch(`${base}/photos/${photo}`);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, 'base64'));
  for (let visit = 0; visit < 2; visit++) {
    const nearby = (await request('/api/facilities?lat=-27.47&lng=153.025&radius=5000'))
      .result.facilities;
    assert.deepEqual(
      nearby.find((row) => row.id === created.result.facility.id).photos,
      [photo],
    );
    assert.equal(nearby.at(-1).id, created.result.facility.id);
    assert.equal(nearby[0].source, 'Brisbane City Council');
  }
  const before = readFileSync(join(directory, 'submissions.json'), 'utf8');
  for (const photos of [
    ['data:image/png;base64,aGVsbG8='],
    Array(4).fill(input.photos[0]),
    ['data:image/svg+xml;base64,PHN2Zz4='],
  ]) {
    assert.equal(
      (await request('/api/submissions', 'POST', { ...input, photos }, true)).response
        .status,
      400,
    );
  }
  const oversized = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`;
  assert.equal(
    (await request('/api/submissions', 'POST', { ...input, photos: [oversized] }, true))
      .response.status,
    413,
  );
  assert.equal(readFileSync(join(directory, 'submissions.json'), 'utf8'), before);
  assert.equal((await request(`/data/photos/${photo}`)).response.status, 404);
});

test('browser contribution import is idempotent and reports persist on disk', async () => {
  const input = {
    name: 'Imported water',
    type: 'water',
    lat: -27.47,
    lng: 153.025,
    clientId: 'community:11111111-1111-4111-8111-111111111111',
  };
  const first = await request('/api/submissions', 'POST', input, true);
  const repeated = await request('/api/submissions', 'POST', input, true);
  assert.equal(first.result.facility.id, repeated.result.facility.id);
  const report = {
    facilityId: first.result.facility.id,
    category: 'Dirty',
    description: 'Imported report',
    clientId: '22222222-2222-4222-8222-222222222222',
  };
  const created = await request('/api/reports', 'POST', report, true);
  const retried = await request('/api/reports', 'POST', report, true);
  assert.equal(created.result.report.id, retried.result.report.id);
  const records = JSON.parse(readFileSync(join(directory, 'reports.json')));
  assert.equal(records.filter((row) => row.clientId === report.clientId).length, 1);
  const resolved = await request(
    `/api/reports/${created.result.report.id}/resolve`,
    'POST',
    { photos: [proofPhoto] },
    true,
  );
  const saved = JSON.parse(readFileSync(join(directory, 'reports.json'))).find(
    (row) => row.id === created.result.report.id,
  );
  assert.equal(saved.resolvedAt, resolved.result.report.resolvedAt);
  assert.equal(
    (await request(`/api/reports?facility=${encodeURIComponent(report.facilityId)}`))
      .result.reports[0].resolvedAt,
    saved.resolvedAt,
  );
});

test('submitted place searches are bounded, validated and cached', async () => {
  assert.equal((await request('/api/search?q=w')).response.status, 400);
  const found = await request('/api/search?q=West%20End');
  assert.equal(found.response.status, 200);
  assert.equal(found.result.places[0].lat, -27.48);
  assert.equal(found.result.places[0].name, 'West End, Brisbane, Queensland');
  await request('/api/search?q=west%20end');
  assert.equal(geocoderCalls, 1);
});

test('route checks reject non-walking or unverifiable modes and accept a walking alternative', async () => {
  const input = {
    points: [
      { lat: -27.47, lng: 153.025 },
      { lat: -27.471, lng: 153.026 },
    ],
  };
  for (const mode of ['ferry', 'driving', 'train', undefined]) {
    routingModes = [mode];
    const result = await request('/api/route', 'POST', input, true);
    assert.equal(result.response.status, 422);
    assert.equal(JSON.parse(readFileSync(join(directory, 'routes.json'))).length, 0);
  }
  routingModes = ['ferry', 'walking'];
  const result = await request('/api/route', 'POST', input);
  assert.equal(result.response.status, 200);
  assert.equal(result.result.route.legs[0].steps[0].mode, 'walking');
  const malformed = structuredClone(result.result.route);
  malformed.legs = [];
  assert.equal(isWalkingOnly(malformed), false);
  const motorway = structuredClone(result.result.route);
  motorway.legs[0].steps[0].intersections = [{ classes: ['motorway'] }];
  assert.equal(isWalkingOnly(motorway), false);
  routingModes = ['walking'];
});

test('favourites, manual visits and personalised reports are private and persist', async () => {
  for (const endpoint of ['favourites', 'visits', 'routes', 'my-activity']) {
    assert.equal((await request(`/api/${endpoint}`)).response.status, 401);
    assert.equal((await request(`/data/${endpoint}.json`)).response.status, 404);
  }
  assert.equal(
    (await request('/api/favourites', 'POST', { facilityId })).response.status,
    401,
  );
  for (let repeat = 0; repeat < 2; repeat++)
    assert.equal(
      (await request('/api/favourites', 'POST', { facilityId }, true)).response.status,
      200,
    );
  assert.equal(
    (await request('/api/favourites', 'GET', undefined, true)).result.favourites.length,
    1,
  );
  assert.equal(JSON.parse(readFileSync(join(directory, 'favourites.json'))).length, 1);
  const favouriteReports = await request(
    '/api/my-activity?source=favourites',
    'GET',
    undefined,
    true,
  );
  assert.equal(favouriteReports.result.reports.length, 10);
  assert.ok(
    favouriteReports.result.reports.every((row) => row.facilityId === facilityId),
  );
  await request('/api/visits', 'POST', { facilityId }, true);
  assert.equal(
    (await request('/api/visits', 'GET', undefined, true)).result.visits.length,
    1,
  );
  await request('/api/favourites', 'DELETE', { facilityId }, true);
  assert.equal(
    (await request('/api/my-activity?source=favourites', 'GET', undefined, true)).result
      .reports.length,
    0,
  );
  assert.equal(
    (await request('/api/my-activity?source=visits', 'GET', undefined, true)).result
      .reports.length,
    10,
  );
});

test('created routes save for their owner and facility stops count as visits', async () => {
  const input = {
    points: [
      { lat: -27.47, lng: 153.025 },
      { lat: -27.4701, lng: 153.025 },
    ],
    stops: [{ id: facilityId, name: 'Test water' }],
    originLabel: 'My start',
    name: 'Morning run',
    roundTrip: false,
  };
  const result = await request('/api/route', 'POST', input, true);
  assert.equal(result.response.status, 200);
  const saved = JSON.parse(readFileSync(join(directory, 'routes.json')));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, result.result.savedRouteId);
  assert.equal(saved[0].draft.stops[0].id, facilityId);
  assert.deepEqual(Object.keys(saved[0]), ['id', 'userId', 'createdAt', 'draft']);
  assert.deepEqual(saved[0].draft.origin, input.points[0]);
  assert.deepEqual(
    saved[0].draft.stops.map(({ lat, lng }) => ({ lat, lng })),
    input.points.slice(1),
  );
  assert.equal(saved[0].draft.roundTrip, false);
  // The calculated path still goes to the live map, but never into route storage.
  assert.equal(result.result.route.geometry.type, 'LineString');
  assert.deepEqual(
    (await request('/api/routes', 'GET', undefined, true)).result.routes[0],
    saved[0],
  );
  const visits = JSON.parse(readFileSync(join(directory, 'visits.json')));
  assert.equal(visits.length, 1);
  assert.equal(visits[0].source, 'route');
  await request('/api/route', 'POST', input);
  assert.equal(JSON.parse(readFileSync(join(directory, 'routes.json'))).length, 1);
  const ownerCookie = cookie;
  const second = await request('/api/register', 'POST', {
    name: 'Another runner',
    email: 'another@example.com',
    password: 'another-test-password',
  });
  cookie = second.response.headers.get('set-cookie').split(';')[0];
  for (const endpoint of ['routes', 'favourites', 'visits'])
    assert.equal(
      (await request(`/api/${endpoint}`, 'GET', undefined, true)).result[endpoint]
        .length,
      0,
    );
  assert.equal(
    (await request('/api/my-activity', 'GET', undefined, true)).result.reports.length,
    0,
  );
  cookie = ownerCookie;
});

test('account editing verifies password, enforces email uniqueness and rotates sessions', async () => {
  const input = {
    name: 'Updated Runner',
    email: 'updated@example.com',
    currentPassword: 'test-password-123',
    newPassword: 'changed-password-123',
  };
  assert.equal((await request('/api/account', 'PUT', input)).response.status, 401);
  assert.equal(
    (
      await request(
        '/api/account',
        'PUT',
        { ...input, currentPassword: 'incorrect' },
        true,
      )
    ).response.status,
    401,
  );
  assert.equal(
    (
      await request(
        '/api/account',
        'PUT',
        { ...input, email: 'ANOTHER@example.com' },
        true,
      )
    ).response.status,
    409,
  );
  assert.equal(
    (await request('/api/account', 'PUT', { ...input, newPassword: 'short' }, true))
      .response.status,
    400,
  );
  const oldCookie = cookie;
  const updated = await request('/api/account', 'PUT', input, true);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.result.user.name, input.name);
  assert.equal(updated.result.user.preferences.radius, 7000);
  assert.equal(updated.result.user.hash, undefined);
  assert.equal((await request('/api/me', 'GET', undefined, true)).result.user, null);
  cookie = updated.response.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie, oldCookie);
  assert.equal(
    (await request('/api/routes', 'GET', undefined, true)).result.routes.length,
    1,
  );
  assert.equal(
    (
      await request('/api/login', 'POST', {
        email: input.email,
        password: input.currentPassword,
      })
    ).response.status,
    401,
  );
  assert.equal(
    (
      await request('/api/login', 'POST', {
        email: input.email,
        password: input.newPassword,
      })
    ).response.status,
    200,
  );
  const saved = JSON.parse(readFileSync(join(directory, 'accounts.json'))).find(
    (row) => row.email === input.email,
  );
  assert.equal(saved.name, input.name);
  assert.equal(saved.password, undefined);
});

test('Council toilet details preserve shower and gender flags, including unknown values', () => {
  const row = {
    facilityid: 'types',
    geopoint: { lat: -27.47, lon: 153.025 },
    male: 'True',
    female: true,
    unisex: 'False',
    allgender: 'True',
    shower: 'False',
  };
  assert.deepEqual(normalize(row, 'toilet').toiletDetails, {
    male: true,
    female: true,
    unisex: false,
    allgender: true,
    shower: false,
  });
  assert.equal(
    normalize({ ...row, shower: true }, 'toilet').toiletDetails.shower,
    true,
  );
  const unknown = normalize(
    { facilityid: 'unknown', geopoint: row.geopoint },
    'toilet',
  );
  assert.deepEqual(unknown.toiletDetails, {
    male: null,
    female: null,
    unisex: null,
    allgender: null,
    shower: null,
  });
});

test('running speed defaults and persists, with bounded numeric values', async () => {
  const before = (await request('/api/me', 'GET', undefined, true)).result.user
    .preferences;
  assert.equal(before.runningSpeed, 10);
  for (const runningSpeed of [6, 12.5, 20]) {
    const result = await request(
      '/api/preferences',
      'PUT',
      { ...before, runningSpeed },
      true,
    );
    assert.equal(result.response.status, 200);
    assert.equal(
      (await request('/api/me', 'GET', undefined, true)).result.user.preferences
        .runningSpeed,
      runningSpeed,
    );
  }
  for (const runningSpeed of [0, 5.5, 20.5, 12.3, '12', null]) {
    assert.equal(
      (await request('/api/preferences', 'PUT', { ...before, runningSpeed }, true))
        .response.status,
      400,
    );
  }
  const account = JSON.parse(readFileSync(join(directory, 'accounts.json'))).find(
    (row) => row.email === 'updated@example.com',
  );
  assert.equal(account.preferences.runningSpeed, 20);
  assert.equal(account.preferences.radius, before.radius);
});

test('toilet route previews use walking validation but never write routes or visits', async () => {
  const beforeRoutes = readFileSync(join(directory, 'routes.json'), 'utf8');
  const beforeVisits = readFileSync(join(directory, 'visits.json'), 'utf8');
  const input = {
    points: [
      { lat: -27.47, lng: 153.025 },
      { lat: -27.4701, lng: 153.025 },
    ],
    preview: true,
  };
  try {
    const preview = await request('/api/route', 'POST', input, true);
    assert.equal(preview.response.status, 200);
    assert.equal(preview.result.savedRouteId, null);
    assert.equal(preview.result.route.geometry.type, 'LineString');
    routingModes = ['ferry'];
    assert.equal(
      (await request('/api/route', 'POST', input, true)).response.status,
      422,
    );
    assert.equal(readFileSync(join(directory, 'routes.json'), 'utf8'), beforeRoutes);
    assert.equal(readFileSync(join(directory, 'visits.json'), 'utf8'), beforeVisits);
  } finally {
    routingModes = ['walking'];
  }
});

test('community toilet details persist, reload, validate and keep unisex filtering consistent', async () => {
  const input = {
    type: 'toilet',
    name: 'Shared shower toilet',
    lat: -27.47,
    lng: 153.025,
    amenities: ['accessible'],
    toiletDetails: {
      shower: true,
      male: true,
      female: true,
      unisex: true,
      allgender: true,
    },
  };
  const result = await request('/api/submissions', 'POST', input, true);
  assert.equal(result.response.status, 201);
  assert.deepEqual(result.result.facility.toiletDetails, input.toiletDetails);
  assert.ok(result.result.facility.amenities.includes('unisex'));
  const saved = JSON.parse(readFileSync(join(directory, 'submissions.json'))).find(
    (row) => row.id === result.result.facility.id,
  );
  assert.deepEqual(saved.toiletDetails, input.toiletDetails);
  const nearby = await request('/api/facilities?lat=-27.47&lng=153.025&radius=5000');
  assert.deepEqual(
    nearby.result.facilities.find((row) => row.id === saved.id).toiletDetails,
    input.toiletDetails,
  );
  const noShower = await request(
    '/api/submissions',
    'POST',
    {
      ...input,
      toiletDetails: { shower: false, unisex: false },
      amenities: ['unisex'],
    },
    true,
  );
  assert.equal(noShower.result.facility.toiletDetails.shower, false);
  assert.equal(noShower.result.facility.toiletDetails.male, null);
  assert.ok(!noShower.result.facility.amenities.includes('unisex'));
  const legacy = await request(
    '/api/submissions',
    'POST',
    { ...input, toiletDetails: undefined, amenities: ['unisex'] },
    true,
  );
  assert.equal(legacy.result.facility.toiletDetails.shower, null);
  assert.equal(legacy.result.facility.toiletDetails.unisex, true);
  const before = readFileSync(join(directory, 'submissions.json'), 'utf8');
  for (const toiletDetails of [[], 'unisex', null, { shower: 'yes' }, { male: 1 }]) {
    assert.equal(
      (await request('/api/submissions', 'POST', { ...input, toiletDetails }, true))
        .response.status,
      400,
    );
  }
  assert.equal(readFileSync(join(directory, 'submissions.json'), 'utf8'), before);
  const water = await request(
    '/api/submissions',
    'POST',
    { ...input, type: 'water' },
    true,
  );
  assert.equal(water.result.facility.toiletDetails, undefined);
});

test('ferries require opt-in; account preferences control both previews and saved routes', async () => {
  const prefs = (await request('/api/me', 'GET', undefined, true)).result.user
    .preferences;
  assert.equal(prefs.allowFerries, false);
  const input = {
    points: [
      { lat: -27.47, lng: 153.025 },
      { lat: -27.471, lng: 153.026 },
    ],
    preview: true,
  };
  const before = readFileSync(join(directory, 'routes.json'), 'utf8');
  try {
    routingModes = ['ferry'];
    assert.equal((await request('/api/route', 'POST', input)).response.status, 422);
    assert.equal(
      (await request('/api/route', 'POST', { ...input, allowFerries: 'true' })).response
        .status,
      400,
    );
    const guest = await request('/api/route', 'POST', { ...input, allowFerries: true });
    assert.equal(guest.response.status, 200);
    assert.equal(
      (await request('/api/route', 'POST', { ...input, allowFerries: true }, true))
        .response.status,
      422,
    );
    await request('/api/preferences', 'PUT', { ...prefs, allowFerries: true }, true);
    assert.equal(
      (await request('/api/me', 'GET', undefined, true)).result.user.preferences
        .allowFerries,
      true,
    );
    const account = JSON.parse(readFileSync(join(directory, 'accounts.json'))).find(
      (row) => row.email === 'updated@example.com',
    );
    assert.equal(account.preferences.allowFerries, true);
    assert.equal(account.preferences.runningSpeed, prefs.runningSpeed);
    assert.equal(
      (await request('/api/route', 'POST', input, true)).response.status,
      200,
    );
    assert.equal(readFileSync(join(directory, 'routes.json'), 'utf8'), before);
    const saved = await request(
      '/api/route',
      'POST',
      { ...input, preview: false },
      true,
    );
    assert.equal(saved.response.status, 200);
    assert.ok(saved.result.savedRouteId);
    const { isAllowedRoute } = await import('../server.js');
    for (const mode of ['driving', 'train', 'bus', undefined]) {
      const invalid = structuredClone(guest.result.route);
      invalid.legs[0].steps[0].mode = mode;
      assert.equal(isAllowedRoute(invalid, true), false);
    }
    const restricted = structuredClone(guest.result.route);
    restricted.legs[0].steps[0].intersections = [{ classes: ['restricted'] }];
    assert.equal(isAllowedRoute(restricted, true), false);
    const ferryClass = structuredClone(guest.result.route);
    ferryClass.legs[0].steps[0].mode = 'walking';
    ferryClass.legs[0].steps[0].intersections = [{ classes: ['ferry'] }];
    assert.equal(isAllowedRoute(ferryClass, false), false);
    assert.equal(isAllowedRoute(ferryClass, true), true);
    await request('/api/preferences', 'PUT', { ...prefs, allowFerries: false }, true);
    assert.equal(
      (await request('/api/route', 'POST', input, true)).response.status,
      422,
    );
  } finally {
    routingModes = ['walking'];
  }
});

test('ferry estimates use crossing duration rather than running speed', async () => {
  const { routeEstimate } = await import('../public/js/helpers.js');
  const route = {
    distance: 5000,
    legs: [
      {
        steps: [
          { mode: 'walking', distance: 1000 },
          { mode: 'ferry', distance: 4000, duration: 300 },
        ],
      },
    ],
  };
  assert.deepEqual(routeEstimate(route, 10), { minutes: 11, hasFerry: true });
  delete route.legs[0].steps[1].duration;
  assert.deepEqual(routeEstimate(route, 10), { minutes: null, hasFerry: true });
  route.legs[0].steps = [{ mode: 'walking', distance: 5000 }];
  assert.deepEqual(routeEstimate(route, 10), { minutes: 30, hasFerry: false });
});

test('imported stores obey radius, support details and local name search, and stay distinct from submissions', async () => {
  const store = {
    id: 'store:node:123',
    type: 'store',
    name: 'NightOwl Test',
    chain: 'NightOwl',
    lat: -27.47,
    lng: 153.025,
    area: 'Brisbane',
    address: '123 Test Street',
    hours: '24/7',
    amenities: [],
    source: 'OpenStreetMap contributors (ODbL)',
  };
  writeFileSync(
    join(directory, 'stores.json'),
    JSON.stringify([store, { ...store, id: 'store:node:456', lat: -27.8 }]),
  );
  try {
    const nearby = await request(
      '/api/facilities?lat=-27.47&lng=153.025&radius=5000',
    );
    assert.deepEqual(
      nearby.result.facilities
        .filter((row) => row.type === 'store')
        .map((row) => row.id),
      [store.id],
    );
    const detail = await request('/api/facility?id=' + encodeURIComponent(store.id));
    assert.equal(detail.result.facility.hours, '24/7');
    const search = await request('/api/search?q=NightOwl%20Test');
    assert.equal(search.result.places[0].facilityId, store.id);
    const favourite = await request(
      '/api/favourites',
      'POST',
      { facilityId: store.id },
      true,
    );
    assert.equal(favourite.response.status, 200);
    assert.ok(
      !JSON.parse(readFileSync(join(directory, 'submissions.json'))).some(
        (row) => row.id === store.id,
      ),
    );
  } finally {
    writeFileSync(join(directory, 'stores.json'), '[]\n');
  }
});

test('community stores require login, persist separately, reload and appear in search', async () => {
  const input = { type: 'store', name: 'Independent corner store', lat: -27.47, lng: 153.025, hours: 'Mo-Su 06:00-22:00', description: 'Beside the park', amenities: ['accessible', 'unisex', 'bottle'], toiletDetails: { shower: true } };
  assert.equal((await request('/api/submissions', 'POST', input)).response.status, 401);
  const created = await request('/api/submissions', 'POST', input, true);
  assert.equal(created.response.status, 201);
  const facility = created.result.facility;
  assert.equal(facility.source, 'Community');
  assert.deepEqual(facility.amenities, ['accessible']);
  assert.equal(facility.toiletDetails, undefined);
  const saved = JSON.parse(readFileSync(join(directory, 'submissions.json'))).find(row => row.id === facility.id);
  assert.equal(saved.hours, input.hours);
  assert.equal(saved.description, input.description);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'stores.json'))), []);
  const near = await request('/api/facilities?lat=-27.47&lng=153.025&radius=5000');
  assert.ok(near.result.facilities.some(row => row.id === facility.id && row.type === 'store'));
  const far = await request('/api/facilities?lat=0&lng=0&radius=5000');
  assert.ok(!far.result.facilities.some(row => row.id === facility.id));
  const search = await request('/api/search?q=Independent%20corner');
  const match = search.result.places.find(row => row.facilityId === facility.id);
  assert.equal(match.name, input.name);
});


test('report photos, mandatory resolution proof, and reopening by another account persist', async () => {
  const input = { facilityId, category: 'Dirty', description: 'Photo report', photos: [proofPhoto] };
  const created = await request('/api/reports', 'POST', input, true);
  assert.equal(created.response.status, 201);
  const id = created.result.report.id;
  const originalPhoto = created.result.report.photos[0];
  assert.ok(readFileSync(join(directory, 'photos', originalPhoto)).length);
  assert.equal((await request(`/api/reports/${id}/resolve`, 'POST', {}, true)).response.status, 400);
  const before = readdirSync(join(directory, 'photos')).length;
  assert.equal((await request(`/api/reports/${id}/resolve`, 'POST', { photos: ['data:image/png;base64,aGVsbG8='] }, true)).response.status, 400);
  assert.equal(readdirSync(join(directory, 'photos')).length, before);
  const resolved = await request(`/api/reports/${id}/resolve`, 'POST', { photos: [proofPhoto] }, true);
  assert.ok(resolved.result.report.resolvedAt);
  assert.equal(resolved.result.report.resolutionHistory[0].photos.length, 1);
  assert.equal((await request(`/api/reports/${id}/reopen`, 'POST', {})).response.status, 401);
  const registered = await request('/api/register', 'POST', { name: 'Other runner', email: 'reopen@example.com', password: 'reopen-password' });
  const otherCookie = registered.response.headers.get('set-cookie').split(';')[0];
  const reopenedResponse = await originalFetch(`${base}/api/reports/${id}/reopen`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: otherCookie }, body: '{}' });
  assert.equal(reopenedResponse.status, 200);
  const reopened = (await reopenedResponse.json()).report;
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.resolutionHistory.at(-1).author, 'Other runner');
  assert.ok(readFileSync(join(directory, 'photos', reopened.resolutionHistory[0].photos[0])).length);
  assert.equal(JSON.parse(readFileSync(join(directory, 'reports.json'))).find(row => row.id === id).resolvedAt, null);
  const counts = await request('/api/facility?id=' + encodeURIComponent(facilityId));
  assert.ok(counts.result.facility.openReports > 0);
});

test('open-only preference defaults on and can be disabled; today weather is available to guests', async () => {
  const me = await request('/api/me', 'GET', undefined, true);
  assert.equal(me.result.user.preferences.quickOpenOnly, true);
  const changed = await request('/api/preferences', 'PUT', { ...me.result.user.preferences, quickOpenOnly: false }, true);
  assert.equal(changed.result.user.preferences.quickOpenOnly, false);
  assert.equal((await request('/api/me', 'GET', undefined, true)).result.user.preferences.quickOpenOnly, false);
  const weather = await request('/api/weather');
  assert.equal(weather.result.weather.temperature, 29);
  assert.equal(weather.result.weather.source, 'BOM ACCESS-G via Open-Meteo');
});
