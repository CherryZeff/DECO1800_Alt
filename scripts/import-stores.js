// Refresh only stores.json. Existing community and account files are never touched.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const regions = [
  { name: 'Brisbane', names: 'City of Brisbane|Brisbane City|Brisbane' },
  { name: 'Logan', names: 'Logan City|City of Logan|Logan' },
  { name: 'Ipswich', names: 'City of Ipswich|Ipswich City|Ipswich' },
];

export function storeChain(tags) {
  const name = [tags.name, tags.brand, tags.operator].filter(Boolean).join(' ');
  if (/\bezy\s*marts?\b/i.test(name)) return 'EzyMart';
  if (/\b7[\s-]*eleven\b/i.test(name)) return '7-Eleven';
  if (/\bnight\s*owl\b/i.test(name)) return 'NightOwl';
  if (/\bfoodary\b/i.test(name)) return 'Foodary';
  if (/\b(?:shell|coles?\s*express)\b/i.test(name)) return 'Shell / Coles Express';
  return null;
}

export function normalizeStores(elements, area, importedAt) {
  return elements.flatMap((element) => {
    const tags = element.tags || {};
    const chain = storeChain(tags);
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (
      !chain ||
      !['node', 'way', 'relation'].includes(element.type) ||
      (tags.shop !== 'convenience' && tags.amenity !== 'fuel') ||
      ['private', 'no'].includes(tags.access) ||
      tags.disused === 'yes' ||
      tags.abandoned === 'yes' ||
      tags.demolished === 'yes' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      return [];
    const address = [
      [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
      tags['addr:suburb'] || tags['addr:city'],
      tags['addr:postcode'],
    ]
      .filter(Boolean)
      .join(', ');
    return [
      {
        id: `store:${element.type}:${element.id}`,
        type: 'store',
        name: tags.name || tags.brand || chain,
        chain,
        lat,
        lng,
        area,
        address,
        hours: tags.opening_hours || 'Opening hours not recorded',
        amenities: [],
        source: 'OpenStreetMap contributors (ODbL)',
        sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        description:
          'Mapped convenience store or fuel station. Store services and opening hours may be incomplete or outdated.',
        importedAt,
      },
    ];
  });
}

export function deduplicateStores(stores) {
  const result = [];
  // OSM sometimes maps the same branch as both a shop node and a fuel-station way.
  for (const store of stores) {
    const existing = result.find(
      (other) =>
        other.id === store.id ||
        (other.chain === store.chain &&
          Math.hypot(
            (other.lat - store.lat) * 111320,
            (other.lng - store.lng) * 111320 * Math.cos((store.lat * Math.PI) / 180),
          ) < 30),
    );
    if (!existing) result.push(store);
    else {
      if (existing.hours === 'Opening hours not recorded')
        existing.hours = store.hours;
      if (!existing.address) existing.address = store.address;
    }
  }
  return result.sort(
    (a, b) =>
      a.area.localeCompare(b.area) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

// Public instances can be unavailable independently. Try each once, in order.
export const overpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export async function fetchOverpass(query, region, endpoints) {
  const failures = [];
  for (const endpoint of endpoints) {
    const url = new URL(endpoint);
    url.searchParams.set('data', query);
    console.log(`${region}: querying ${url.hostname}…`);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'ParkPal-store-import/1.0' },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        // Read the short provider explanation, never print a whole HTML error page.
        const detail = (await response.text())
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);
        const error = new Error(
          `HTTP ${response.status}${detail ? ` (${detail})` : ''}`,
        );
        error.invalidQuery = response.status === 400;
        throw error;
      }
      const data = await response.json();
      if (data.remark || !Array.isArray(data.elements))
        throw new Error(
          `Incomplete response: ${String(data.remark || 'missing elements').slice(0, 180)}`,
        );
      return data;
    } catch (error) {
      // A bad query needs correction; repeating it on other hosts cannot help.
      if (error.invalidQuery) throw new Error(`${region}: ${error.message}`);
      const reason =
        error.name === 'TimeoutError' ? 'timed out after 60 seconds' : error.message;
      failures.push(`${url.hostname}: ${reason}`);
      console.warn(`${region}: ${url.hostname} failed: ${reason}`);
    }
  }
  throw new Error(
    `All configured Overpass services failed for ${region}. ${failures.join('; ')}. Try again later or set OVERPASS_URL to another global Overpass endpoint.`,
  );
}

export async function importStores() {
  // An explicit URL stays exclusive, for private/self-hosted providers.
  const endpoints = process.env.OVERPASS_URL
    ? [process.env.OVERPASS_URL]
    : overpassEndpoints;
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const directory = resolve(process.env.DATA_DIR || join(root, 'data'));
  const importedAt = new Date().toISOString();
  const stores = [];
  for (const region of regions) {
    // Administrative polygons, rather than a broad bounding box, exclude neighbouring councils.
    const areas = region.names
      .split('|')
      .map((name) => `area["name"="${name}"]["admin_level"="6"];`)
      .join('');
    const query = `[out:json][timeout:45];
      (${areas})->.region;
      .region out tags;
      (nwr(area.region)["shop"="convenience"];nwr(area.region)["amenity"="fuel"];);
      out center tags;`;
    const data = await fetchOverpass(query, region.name, endpoints);
    const boundaries = data.elements.filter((row) => row.type === 'area');
    if (boundaries.length !== 1)
      throw new Error(
        `Expected one council boundary for ${region.name}; got ${boundaries.length}.`,
      );
    if (!boundaries[0].tags?.['ref:psma:lga_pid']?.startsWith('QLD'))
      throw new Error(
        `The ${region.name} boundary could not be verified as Queensland.`,
      );
    const rows = normalizeStores(data.elements, region.name, importedAt);
    if (!rows.length)
      throw new Error(
        `No matching stores returned for ${region.name}; keeping the previous file.`,
      );
    stores.push(...rows);
    console.log(`${region.name}: ${rows.length} matching OSM records`);
  }
  const unique = deduplicateStores(stores);
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'stores.json');
  // Replace the snapshot only after all three queries succeed; failures preserve old data.
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(unique, null, 2) + '\n');
  await rename(temporary, file);
  console.log(`Saved ${unique.length} stores to ${file}`);
  for (const chain of [
    'EzyMart',
    '7-Eleven',
    'Shell / Coles Express',
    'NightOwl',
    'Foodary',
  ]) {
    console.log(`${chain}: ${unique.filter((row) => row.chain === chain).length}`);
  }
  console.log(
    `${unique.filter((row) => row.hours === 'Opening hours not recorded').length} stores have no recorded opening hours.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importStores().catch((error) => {
    console.error(`Store import failed: ${error.message} Existing data was kept.`);
    process.exitCode = 1;
  });
}
