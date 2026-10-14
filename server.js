// ParkPal's shared storage: serve the pages, write JSON, and store facility photos.
import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

// Overseas routing hosts can need more than Node's 250 ms connection attempt.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const photosDir = join(dataDir, 'photos');
const hashPassword = promisify(scrypt);
const sessions = new Map();
const attempts = new Map();
const cache = new Map();
const knownFacilities = new Map();
const allowedAmenities = ['accessible', 'unisex', 'babychange', 'bottle', 'dog'];
const problemTypes = [
  'Broken',
  'Dirty',
  'Unavailable',
  'Under construction',
  'Missing',
  'Other',
];
const datasets = {
  toilet: { name: 'public-toilets-in-brisbane', geo: 'geopoint' },
  water: { name: 'park-drinking-fountain-tap-locations', geo: 'geo_point_2d' },
};
mkdirSync(dataDir, { recursive: true });
mkdirSync(photosDir, { recursive: true });
for (const name of ['accounts', 'submissions', 'reports']) {
  try {
    readFileSync(join(dataDir, `${name}.json`));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    writeFileSync(join(dataDir, `${name}.json`), '[]\n', { mode: 0o600 });
  }
}
function read(name) {
  return JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf8'));
}
// Synchronous read-modify-write sections cannot interleave in this single process.
function save(name, rows) {
  const file = join(dataDir, `${name}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(rows, null, 2) + '\n', {
    mode: 0o600,
  });
  renameSync(`${file}.tmp`, file);
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function clean(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function position(value) {
  if (
    !value ||
    typeof value.lat !== 'number' ||
    typeof value.lng !== 'number' ||
    !Number.isFinite(value.lat) ||
    !Number.isFinite(value.lng) ||
    Math.abs(value.lat) > 90 ||
    Math.abs(value.lng) > 180
  )
    fail('Choose a valid map location.');
  return { lat: value.lat, lng: value.lng };
}
function preferences(value = {}) {
  const result = Object.fromEntries(
    ['accessible', 'unisex', 'babychange', 'bottle', 'hideIssues'].map((key) => [
      key,
      value?.[key] === true,
    ]),
  );
  result.radius = value.radius === undefined ? 5000 : validRadius(value.radius);
  return result;
}
function validRadius(value) {
  if (!Number.isInteger(value) || value < 1000 || value > 10000 || value % 1000 !== 0)
    fail('Choose a radius from 1 to 10 km in 1 km steps.');
  return value;
}
function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    preferences: {
      ...account.preferences,
      radius: account.preferences?.radius || 5000,
    },
  };
}
function currentUser(req) {
  const token = (req.headers.cookie || '').match(/(?:^|; )runstop=([a-f0-9]+)/)?.[1];
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return read('accounts').find((user) => user.id === session.userId) || null;
}
function requireUser(req) {
  const user = currentUser(req);
  if (!user) fail('Sign in to contribute.', 401);
  return user;
}
function sessionCookie(req, res, userId) {
  const token = randomBytes(32).toString('hex');
  for (const [key, session] of sessions)
    if (session.expires < Date.now()) sessions.delete(key);
  sessions.set(token, { userId, expires: Date.now() + 86400000 * 7 });
  res.setHeader(
    'Set-Cookie',
    `runstop=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.SECURE_COOKIES === '1' ? '; Secure' : ''}`,
  );
}
async function body(req, limit = 16384) {
  let raw = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > limit) fail('Submission is too large.', 413);
  }
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') fail('Invalid request.');
    return value;
  } catch {
    fail('Send a valid JSON object.');
  }
}

// Validate every photo before writing any files. SVG and arbitrary uploads are rejected.
function preparePhotos(photos = []) {
  if (!Array.isArray(photos) || photos.length > 3) fail('Add at most 3 photos.');
  return photos.map((photo) => {
    if (typeof photo !== 'string') fail('Invalid photo.');
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
    if (!match) fail('Photos must be JPEG, PNG or WebP images.');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 2 * 1024 * 1024)
      fail('Each photo must be 2 MB or smaller.', 413);
    const type = match[1];
    const valid =
      type === 'jpeg'
        ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : type === 'png'
          ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : buffer.toString('ascii', 0, 4) === 'RIFF' &&
            buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) fail('The photo content does not match its image type.');
    return {
      filename: `${randomUUID()}.${type === 'jpeg' ? 'jpg' : type}`,
      buffer,
    };
  });
}

function existingImport(collection, input, user) {
  if (!input.clientId) return null;
  if (
    typeof input.clientId !== 'string' ||
    !/^(community:)?[a-f0-9-]{36}$/.test(input.clientId)
  )
    fail('Invalid import identifier.');
  return read(collection).find(
    (row) => row.clientId === input.clientId && row.userId === user.id,
  );
}
function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad,
    dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
const yes = (value) => value === true || String(value).toLowerCase() === 'true';
export function normalize(row, type) {
  const point = type === 'toilet' ? row.geopoint : row.geo_point_2d;
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  const amenities =
    type === 'toilet'
      ? ['accessible', 'unisex', 'babychange'].filter((key) => yes(row[key]))
      : []; // Don't infer bottle filling or accessibility from ambiguous equipment names.
  return {
    id: `${type}:${type === 'toilet' ? row.facilityid : row.objectid}`,
    type,
    name: row.name || row.park_name || 'Drinking fountain',
    lat: point.lat,
    lng: point.lon,
    amenities,
    address:
      type === 'toilet' ? [row.address1, row.town].filter(Boolean).join(', ') : row.park_name,
    hours:
      type === 'toilet'
        ? row.openinghours || 'Opening hours not provided'
        : 'Opening hours not provided',
    description:
      type === 'toilet'
        ? [row.addressnote, row.accessnote, row.toiletnote, row.openinghoursnote]
            .filter(Boolean)
            .join(' ')
        : row.item_description || '',
    restrictions:
      type === 'toilet'
        ? [
            yes(row.keyrequired) && 'Key required',
            yes(row.paymentrequired) && 'Payment required',
          ].filter(Boolean)
        : [],
    source: 'Brisbane City Council',
    createdAt: null,
  };
}
async function external(url) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': 'RunStop/1.0 (Brisbane running facilities prototype)',
      },
    });
  } catch {
    fail('Could not connect to the external data service. Please try again shortly.', 502);
  }
  if (!response.ok) fail('The external data service is unavailable. Please try again.', 502);
  return response.json();
}
async function councilNearby(type, center, radius) {
  const dataset = datasets[type];
  const key = `${type}:${center.lat}:${center.lng}:${radius}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.rows;
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const url = new URL(
      `https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/${dataset.name}/records`,
    );
    url.searchParams.set(
      'where',
      `within_distance(${dataset.geo}, GEOM'POINT(${center.lng} ${center.lat})', ${radius}m)`,
    );
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', String(offset));
    const result = await external(url);
    if (!Array.isArray(result.results)) fail('Council returned an unexpected response.', 502);
    for (const row of result.results) {
      const facility = normalize(row, type);
      if (facility) {
        rows.push(facility);
        knownFacilities.set(facility.id, facility);
      }
    }
    if (offset + result.results.length >= result.total_count || !result.results.length) break;
  }
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  cache.set(key, { rows, expires: Date.now() + 300000 });
  return rows;
}
async function findFacility(id) {
  const submitted = read('submissions').find((row) => row.id === id);
  if (submitted) return submitted;
  if (knownFacilities.has(id)) return knownFacilities.get(id);
  const match = /^(toilet|water):(\d+)$/.exec(id);
  if (!match) fail('Facility not found.', 404);
  const [, type, recordId] = match;
  const url = new URL(
    `https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/${datasets[type].name}/records`,
  );
  url.searchParams.set(
    'where',
    `${type === 'toilet' ? 'facilityid' : 'objectid'}="${recordId}"`,
  );
  url.searchParams.set('limit', '1');
  const result = await external(url);
  const facility = result.results?.[0] && normalize(result.results[0], type);
  if (!facility) fail('Facility not found.', 404);
  knownFacilities.set(id, facility);
  return facility;
}
let routeQueue = Promise.resolve();
let lastRoute = 0;
function walkingRoute(points) {
  // Respect the public routing service's one-request-per-second limit.
  const task = routeQueue.then(async () => {
    await new Promise((done) =>
      setTimeout(done, Math.max(0, 1100 - (Date.now() - lastRoute))),
    );
    lastRoute = Date.now();
    const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(';');
    const result = await external(
      `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordinates}?overview=full&geometries=geojson&steps=true&radiuses=${points.map(() => '150').join(';')}`,
    );
    if (result.code !== 'Ok' || !result.routes?.length)
      fail('No walking route found. Move the stop closer to a path and try again.', 422);
    return { ...result.routes[0], waypoints: result.waypoints };
  });
  routeQueue = task.catch(() => {});
  return task;
}
async function api(req, res, url) {
  const path = url.pathname;
  if (req.method !== 'GET') {
    if (req.headers['sec-fetch-site'] === 'cross-site')
      fail('Cross-site requests are not allowed.', 403);
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
      fail('Invalid request origin.', 403);
    if (!req.headers['content-type']?.startsWith('application/json'))
      fail('Use application/json.', 415);
  }
  if (path === '/api/me' && req.method === 'GET') {
    const user = currentUser(req);
    return json(res, 200, { user: user ? publicAccount(user) : null });
  }
  if (['/api/register', '/api/login'].includes(path) && req.method === 'POST') {
    const ip = req.socket.remoteAddress;
    for (const [key, record] of attempts) if (record.until < Date.now()) attempts.delete(key);
    const attempt = attempts.get(ip) || {
      count: 0,
      until: Date.now() + 900000,
    };
    if (++attempt.count > 30) fail('Too many sign-in attempts. Try again in 15 minutes.', 429);
    attempts.set(ip, attempt);
    const input = await body(req),
      email = clean(input.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.');
    if (
      typeof input.password !== 'string' ||
      input.password.length < 8 ||
      input.password.length > 128
    )
      fail('Use a password between 8 and 128 characters.');
    let account = read('accounts').find((row) => row.email === email);
    if (path === '/api/register') {
      const name = clean(input.name, 60);
      if (!name) fail('Enter your name.');
      if (account) fail('An account already uses this email.', 409);
      const salt = randomBytes(16).toString('hex');
      const hash = (await hashPassword(input.password, salt, 64)).toString('hex');
      account = {
        id: randomUUID(),
        name,
        email,
        salt,
        hash,
        preferences: preferences(),
        createdAt: new Date().toISOString(),
      };
      const accounts = read('accounts'); // Re-read after async hashing to preserve concurrent registrations.
      if (accounts.some((row) => row.email === email))
        fail('An account already uses this email.', 409);
      accounts.push(account);
      save('accounts', accounts);
    } else {
      const hash = await hashPassword(input.password, account?.salt || 'unknown-account', 64);
      if (!account || !timingSafeEqual(hash, Buffer.from(account.hash, 'hex')))
        fail('Email or password is incorrect.', 401);
    }
    sessionCookie(req, res, account.id);
    return json(res, 200, { user: publicAccount(account) });
  }
  if (path === '/api/logout' && req.method === 'POST') {
    const token = (req.headers.cookie || '').match(/(?:^|; )runstop=([a-f0-9]+)/)?.[1];
    sessions.delete(token);
    res.setHeader('Set-Cookie', 'runstop=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (path === '/api/preferences' && req.method === 'PUT') {
    const user = requireUser(req),
      input = await body(req);
    const accounts = read('accounts'),
      account = accounts.find((row) => row.id === user.id);
    account.preferences = preferences(input);
    save('accounts', accounts);
    return json(res, 200, { user: publicAccount(account) });
  }
  if (path === '/api/facilities' && req.method === 'GET') {
    if (!url.searchParams.has('lat') || !url.searchParams.has('lng'))
      fail('Location is required.');
    const center = position({
      lat: Number(url.searchParams.get('lat')),
      lng: Number(url.searchParams.get('lng')),
    });
    const radius = validRadius(Number(url.searchParams.get('radius') || 5000));
    const results = await Promise.allSettled(
      ['toilet', 'water'].map((type) => councilNearby(type, center, radius)),
    );
    const warnings = [];
    const facilities = results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      warnings.push(
        `${index === 0 ? 'Council toilets' : 'Council drinking fountains'} could not be loaded. Retry to refresh the map.`,
      );
      return [];
    });
    // Council requests finish first. Always read shared submissions fresh from disk after them.
    facilities.push(...read('submissions').filter((row) => distance(center, row) <= radius));
    const reports = read('reports');
    return json(res, 200, {
      facilities: facilities.map((row) => ({
        ...row,
        openReports: reports.filter(
          (report) => report.facilityId === row.id && !report.resolvedAt,
        ).length,
      })),
      warnings,
    });
  }
  if (path === '/api/submissions' && req.method === 'GET') {
    return json(res, 200, { submissions: read('submissions') });
  }
  if (path === '/api/submissions' && req.method === 'POST') {
    const user = requireUser(req),
      input = await body(req, 9 * 1024 * 1024),
      point = position(input);
    const existing = existingImport('submissions', input, user);
    if (existing) return json(res, 200, { facility: existing });
    if (!['toilet', 'water'].includes(input.type)) fail('Choose a facility type.');
    if (!clean(input.name)) fail('Give this facility a name.');
    const photos = preparePhotos(input.photos);
    const row = {
      id: `community:${randomUUID()}`,
      type: input.type,
      name: clean(input.name),
      ...point,
      amenities: Array.isArray(input.amenities)
        ? [...new Set(input.amenities.filter((value) => allowedAmenities.includes(value)))]
        : [],
      description: clean(input.description, 1000),
      address: clean(input.address),
      hours: clean(input.hours) || 'Opening hours not provided',
      restrictions: [],
      source: 'Community',
      author: user.name,
      userId: user.id,
      createdAt: new Date().toISOString(),
      photos: photos.map((photo) => photo.filename),
      ...(input.clientId ? { clientId: input.clientId } : {}),
    };
    const rows = read('submissions');
    rows.push(row);
    const written = [];
    try {
      for (const photo of photos) {
        writeFileSync(join(photosDir, photo.filename), photo.buffer, {
          flag: 'wx',
          mode: 0o600,
        });
        written.push(photo.filename);
      }
      save('submissions', rows);
    } catch (error) {
      for (const filename of written) unlinkSync(join(photosDir, filename));
      throw error;
    }
    return json(res, 201, { facility: { ...row, openReports: 0 } });
  }
  if (path === '/api/reports' && req.method === 'GET') {
    const facilityId = url.searchParams.get('facility');
    const reports = read('reports').filter(
      (row) => !facilityId || row.facilityId === facilityId,
    );
    const sorted = reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(res, 200, {
      reports: sorted.slice(0, 10),
      unresolved: facilityId ? sorted.filter((row) => !row.resolvedAt) : [],
    });
  }
  if (path === '/api/reports' && req.method === 'POST') {
    const user = requireUser(req),
      input = await body(req);
    const existing = existingImport('reports', input, user);
    if (existing) return json(res, 200, { report: existing });
    if (!problemTypes.includes(input.category)) fail('Select a problem category.');
    const facility = await findFacility(clean(input.facilityId));
    const row = {
      id: randomUUID(),
      facilityId: facility.id,
      facilityName: facility.name,
      facilityType: facility.type,
      lat: facility.lat,
      lng: facility.lng,
      category: input.category,
      description: clean(input.description, 1000),
      author: user.name,
      userId: user.id,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      ...(input.clientId ? { clientId: input.clientId } : {}),
    };
    const rows = read('reports');
    rows.push(row);
    save('reports', rows);
    return json(res, 201, { report: row });
  }
  if (path.match(/^\/api\/reports\/[^/]+\/resolve$/) && req.method === 'POST') {
    const user = requireUser(req),
      id = path.split('/')[3];
    const rows = read('reports'),
      report = rows.find((row) => row.id === id);
    if (!report) fail('Report not found.', 404);
    if (!report.resolvedAt) {
      report.resolvedAt = new Date().toISOString();
      report.resolvedBy = user.name;
      save('reports', rows);
    }
    return json(res, 200, { report });
  }
  if (path === '/api/route' && req.method === 'POST') {
    const input = await body(req);
    if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > 12)
      fail('Choose between 2 and 12 route points.');
    return json(res, 200, {
      route: await walkingRoute(input.points.map(position)),
    });
  }
  fail('Not found.', 404);
}
const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
};
const publicFiles = [
  'routes.html',
  'accounts.html',
  'activity.html',
  'style.css',
  'icon.svg',
  'icons.svg',
  'js/helpers.js',
  'js/storage.js',
  'js/services.js',
  'js/map.js',
  'js/route-state.js',
  'js/reports.js',
  'js/facility-details.js',
  'js/index.js',
  'js/routes.js',
  'js/accounts.js',
  'js/activity.js',
  'js/api.js',
  'js/migration.js',
  'js/photos.js',
];
const staticFiles = new Map(publicFiles.map((file) => [`/public/${file}`, `public/${file}`]));
staticFiles.set('/', 'index.html');
staticFiles.set('/index.html', 'index.html');
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (
      /^\/photos\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(url.pathname) &&
      ['GET', 'HEAD'].includes(req.method)
    ) {
      const filename = url.pathname.slice('/photos/'.length);
      let photo;
      try {
        photo = readFileSync(join(photosDir, filename));
      } catch (error) {
        if (error.code === 'ENOENT') fail('Photo not found.', 404);
        throw error;
      }
      const extension = filename.split('.').pop();
      res.writeHead(200, {
        'Content-Type': `image/${extension === 'jpg' ? 'jpeg' : extension}`,
        'Content-Length': photo.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      return res.end(req.method === 'HEAD' ? undefined : photo);
    }
    const file = staticFiles.get(url.pathname);
    if (!file || !['GET', 'HEAD'].includes(req.method)) fail('Not found.', 404);
    const content = readFileSync(join(root, file));
    res.writeHead(200, {
      'Content-Type': `${mime[file.slice(file.lastIndexOf('.'))]}; charset=utf-8`,
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (!error.status) console.error(error);
    json(res, error.status || 500, {
      error: error.status ? error.message : 'The request failed. Please try again.',
    });
  }
});
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () =>
    console.log(`ParkPal: http://localhost:${server.address().port}`),
  );
}
