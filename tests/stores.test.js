import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStores,
  deduplicateStores,
  storeChain,
  fetchOverpass,
} from '../scripts/import-stores.js';

test('store importer recognises requested chains without accepting unrelated brands', () => {
  for (const name of [
    'EzyMart',
    'Ezy Mart',
    '7-Eleven',
    '7 Eleven',
    'Shell',
    'Coles Express',
    'NightOwl',
    'Night Owl',
    'Ampol Foodary',
  ]) {
    assert.ok(storeChain({ name }), name);
  }
  for (const name of ['BP', 'Ampol', 'Woolworths', 'Shellfish Cafe']) {
    assert.equal(storeChain({ name }), null, name);
  }
});

test('store importer preserves real hours, handles way centres, and skips unusable records', () => {
  const node = {
    type: 'node',
    id: 1,
    lat: -27.47,
    lon: 153.02,
    tags: {
      shop: 'convenience',
      brand: '7-Eleven',
      opening_hours: 'Mo-Fr 06:00-22:00',
    },
  };
  const way = {
    type: 'way',
    id: 2,
    center: { lat: -27.5, lon: 153.03 },
    tags: { amenity: 'fuel', name: 'Shell' },
  };
  const rows = normalizeStores(
    [
      node,
      way,
      { ...node, tags: { ...node.tags, access: 'private' } },
      { ...node, tags: { ...node.tags, disused: 'yes' } },
      { ...node, lat: NaN },
      { ...node, tags: { name: '7-Eleven', shop: 'vacant' } },
      { type: 'area', id: 123, tags: { name: 'Brisbane' } },
    ],
    'Brisbane',
    '2026-10-15T00:00:00Z',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hours, 'Mo-Fr 06:00-22:00');
  assert.equal(rows[0].id, 'store:node:1');
  assert.equal(rows[1].lat, -27.5);
  assert.equal(rows[1].hours, 'Opening hours not recorded');
  assert.equal(rows[1].area, 'Brisbane');
});

test('co-located shop and fuel records merge hours without merging different chains or distant branches', () => {
  const store = {
    id: 'store:node:1',
    chain: '7-Eleven',
    name: '7-Eleven',
    lat: -27.47,
    lng: 153.02,
    area: 'Brisbane',
    hours: 'Opening hours not recorded',
    address: '',
  };
  const result = deduplicateStores([
    store,
    {
      ...store,
      id: 'store:way:2',
      lng: 153.02001,
      hours: '24/7',
      address: '1 Test Street',
    },
    { ...store, id: 'store:node:3', lng: 153.03 },
    { ...store, id: 'store:node:4', chain: 'NightOwl' },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result.find((row) => row.id === store.id).hours, '24/7');
  assert.equal(result.find((row) => row.id === store.id).address, '1 Test Street');
});

test('import replaces the snapshot only after all three areas succeed', async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { importStores } = await import('../scripts/import-stores.js');
  const directory = await mkdtemp(join(tmpdir(), 'parkpal-import-test-'));
  const originalFetch = globalThis.fetch,
    originalDirectory = process.env.DATA_DIR,
    originalEndpoint = process.env.OVERPASS_URL;
  process.env.DATA_DIR = directory;
  process.env.OVERPASS_URL = 'https://test.example/api/interpreter';
  let calls = 0,
    failSecond = false;
  globalThis.fetch = async (url, options) => {
    calls++;
    const query = new URL(url).searchParams.get('data');
    assert.ok(query.includes('["admin_level"="6"]'));
    assert.ok(query.includes('nwr(area.region)'));
    if (failSecond && calls === 2) return new Response('Busy', { status: 503 });
    return Response.json({
      elements: [
        {
          type: 'area',
          id: calls,
          tags: { boundary: 'administrative', 'ref:psma:lga_pid': 'QLD21' },
        },
        {
          type: 'node',
          id: calls,
          lat: -27 - calls / 10,
          lon: 153,
          tags: { shop: 'convenience', name: 'NightOwl', opening_hours: '24/7' },
        },
      ],
    });
  };
  try {
    await writeFile(join(directory, 'accounts.json'), '[{"id":"untouched"}]');
    await importStores();
    const snapshot = await readFile(join(directory, 'stores.json'), 'utf8');
    assert.deepEqual(
      new Set(JSON.parse(snapshot).map((row) => row.area)),
      new Set(['Brisbane', 'Logan', 'Ipswich']),
    );
    calls = 0;
    failSecond = true;
    await assert.rejects(importStores(), /HTTP 503/);
    assert.equal(await readFile(join(directory, 'stores.json'), 'utf8'), snapshot);
    assert.equal(
      await readFile(join(directory, 'accounts.json'), 'utf8'),
      '[{"id":"untouched"}]',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDirectory === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDirectory;
    if (originalEndpoint === undefined) delete process.env.OVERPASS_URL;
    else process.env.OVERPASS_URL = originalEndpoint;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Overpass falls back on service errors, network failures and incomplete results', async () => {
  const originalFetch = globalThis.fetch;
  const endpoints = ['https://first.example/api', 'https://second.example/api'];
  try {
    for (const failure of [
      () => new Response('<h1>Server error</h1>', { status: 500 }),
      () => {
        throw new Error('connection failed');
      },
      () => Response.json({ elements: [], remark: 'runtime error: timed out' }),
      () => new Response('<html>not JSON</html>'),
    ]) {
      const calls = [];
      globalThis.fetch = async (url) => {
        calls.push(url.hostname);
        return calls.length === 1
          ? failure()
          : Response.json({ elements: [{ id: 123 }] });
      };
      const result = await fetchOverpass('[out:json];out;', 'Brisbane', endpoints);
      assert.equal(result.elements[0].id, 123);
      assert.deepEqual(calls, ['first.example', 'second.example']);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid Overpass queries stop immediately; unavailable hosts produce an actionable error', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response('Parse error', { status: 400 });
    };
    await assert.rejects(
      fetchOverpass('bad query', 'Logan', [
        'https://one.example',
        'https://two.example',
      ]),
      /HTTP 400/,
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response('Busy', { status: 503 });
    await assert.rejects(
      fetchOverpass('query', 'Logan', ['https://one.example']),
      /All configured Overpass services failed.*OVERPASS_URL/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
