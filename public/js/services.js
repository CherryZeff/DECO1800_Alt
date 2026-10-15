// The backend loads council records first, then reads saved user submissions.
// One shared source of truth means navigation and reloads preserve contributions.
import { apiRequest } from './api.js';

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
    stops: draft.stops?.map((stop) => ({ id: stop.id, name: stop.name })),
    originLabel: draft.originLabel,
    roundTrip: draft.roundTrip,
  });
}
