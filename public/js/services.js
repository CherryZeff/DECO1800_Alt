// The backend loads council records first, then reads saved user submissions.
// One shared source of truth means navigation and reloads preserve contributions.
import { apiRequest } from './api.js';
import { getPreferences } from './storage.js';

export function getFacilities(center, radius) {
  const query = new URLSearchParams({
    lat: center.lat,
    lng: center.lng,
    radius,
  });
  return apiRequest(`facilities?${query}`);
}

export async function getWalkingRoute(points, draft = {}) {
  const coordinates = points.map((point) => ({
    lat: point.lat,
    lng: point.lng,
  }));
  return await apiRequest('route', 'POST', {
    points: coordinates,
    allowFerries: getPreferences().allowFerries === true,
    stops: draft.stops?.map((stop) => ({ id: stop.id, name: stop.name })),
    originLabel: draft.originLabel,
    roundTrip: draft.roundTrip,
  });
}

// Comparing nearby toilets must not save routes or mark their facilities visited.
export async function previewWalkingRoute(points) {
  return (
    await apiRequest('route', 'POST', {
      points: points.map(({ lat, lng }) => ({ lat, lng })),
      preview: true,
      allowFerries: getPreferences().allowFerries === true,
    })
  ).route;
}
