// A route draft survives page navigation in this tab, but is not an account record.
export function readRoute() {
  const fallback = {
    origin: { lat: -27.4698, lng: 153.0251 },
    originLabel: 'Brisbane preview start',
    stops: [],
    roundTrip: false,
  };
  try {
    return JSON.parse(sessionStorage.getItem('parkpal.route')) || fallback;
  } catch {
    return fallback;
  }
}

export function saveRoute(route) {
  sessionStorage.setItem('parkpal.route', JSON.stringify(route));
}

export function addRouteStop(facility) {
  const route = readRoute();
  if (route.stops.length >= 10) throw new Error('You can add up to 10 stops.');
  if (facility.id && route.stops.some((stop) => stop.id === facility.id)) {
    throw new Error('This facility is already on your route.');
  }
  route.stops.push(facility);
  saveRoute(route);
}
