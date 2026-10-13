// Public data requests run directly in the browser, so Live Server is enough.
import { distanceBetween } from './helpers.js';
import { readSaved, getReports } from './storage.js';

const councilAPI = 'https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/';
const datasets = {
  toilet: { name: 'public-toilets-in-brisbane', point: 'geopoint' },
  water: { name: 'park-drinking-fountain-tap-locations', point: 'geo_point_2d' },
};
const cache = new Map();

async function fetchJSON(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  } catch {
    throw new Error('Could not reach the data service. Check your connection and try again.');
  }
  if (!response.ok) throw new Error('The data service is unavailable. Please try again.');
  return response.json();
}

// Council fields differ between the two datasets; convert them to one shape.
function normaliseFacility(record, type) {
  const point = record[datasets[type].point];
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  const isTrue = (value) => String(value).toLowerCase() === 'true';
  const isToilet = type === 'toilet';
  return {
    id: `${type}:${isToilet ? record.facilityid : record.objectid}`,
    type,
    name: record.name || record.park_name || 'Drinking fountain',
    lat: point.lat,
    lng: point.lon,
    amenities: isToilet
      ? ['accessible', 'unisex', 'babychange'].filter((key) => isTrue(record[key]))
      : [],
    address: isToilet
      ? [record.address1, record.town].filter(Boolean).join(', ')
      : record.park_name,
    hours: record.openinghours || 'Opening hours not provided',
    description: isToilet
      ? [record.addressnote, record.accessnote, record.toiletnote, record.openinghoursnote]
          .filter(Boolean)
          .join(' ')
      : record.item_description || '',
    restrictions: isToilet
      ? [
          isTrue(record.keyrequired) && 'Key required',
          isTrue(record.paymentrequired) && 'Payment required',
        ].filter(Boolean)
      : [],
    source: 'Brisbane City Council',
  };
}

async function fetchCouncilFacilities(type, center, radius) {
  const cacheKey = `${type}:${center.lat}:${center.lng}:${radius}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.facilities;
  const dataset = datasets[type];
  const facilities = [];

  // The API returns at most 100 records per page. Keep requesting matching pages.
  for (let offset = 0; ; offset += 100) {
    const url = new URL(`${councilAPI}${dataset.name}/records`);
    url.searchParams.set(
      'where',
      `within_distance(${dataset.point}, GEOM'POINT(${center.lng} ${center.lat})', ${radius}m)`,
    );
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', String(offset));
    const result = await fetchJSON(url);
    if (!Array.isArray(result.results)) throw new Error('Unexpected council data response.');
    for (const record of result.results) {
      const facility = normaliseFacility(record, type);
      if (facility) facilities.push(facility);
    }
    if (!result.results.length || offset + result.results.length >= result.total_count) break;
  }
  if (cache.size > 30) cache.clear();
  cache.set(cacheKey, { facilities, expires: Date.now() + 300000 });
  return facilities;
}

export function attachReportCounts(facilities) {
  const reports = getReports();
  return facilities.map((facility) => ({
    ...facility,
    openReports: reports.filter((report) => report.facilityId === facility.id && !report.resolvedAt)
      .length,
  }));
}

export async function getFacilities(center, radius) {
  const results = await Promise.allSettled([
    fetchCouncilFacilities('toilet', center, radius),
    fetchCouncilFacilities('water', center, radius),
  ]);
  const facilities = [];
  const warnings = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') facilities.push(...result.value);
    else
      warnings.push(
        `${index === 0 ? 'Council toilets' : 'Council fountains'} could not load. Please refresh.`,
      );
  });
  const submissions = readSaved('submissions', []).filter(
    (facility) => distanceBetween(center, facility) <= radius,
  );
  return { facilities: attachReportCounts([...facilities, ...submissions]), warnings };
}

let routeQueue = Promise.resolve();
export function getWalkingRoute(points) {
  const request = routeQueue.then(async () => {
    // Space requests from this browser to respect the public routing service.
    const lastRequest = Number(sessionStorage.getItem('parkpal.lastRoute') || 0);
    const pause = Math.max(0, 1100 - (Date.now() - lastRequest));
    await new Promise((resolve) => setTimeout(resolve, pause));
    sessionStorage.setItem('parkpal.lastRoute', String(Date.now()));
    const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(';');
    const url = new URL(
      `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordinates}`,
    );
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'true');
    url.searchParams.set('radiuses', points.map(() => '150').join(';'));
    const result = await fetchJSON(url);
    if (result.code !== 'Ok' || !result.routes?.length) {
      throw new Error('No walking route found. Move the stop closer to a path and try again.');
    }
    return { ...result.routes[0], waypoints: result.waypoints };
  });
  routeQueue = request.catch(() => {});
  return request;
}
