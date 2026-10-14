// Leaflet details live here so the page scripts can focus on user actions.
import { icon, notify } from './helpers.js';

export class FacilityMap {
  constructor(onFacilityClick, onMapClick) {
    this.map = null;
    if (!window.L) {
      document.querySelector('#map-error').hidden = false;
      return;
    }
    this.map = L.map('map', { zoomControl: false }).setView([-27.4698, 153.0251], 14);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://data.brisbane.qld.gov.au/">Brisbane City Council</a>',
    }).addTo(this.map);
    tiles.once('tileerror', () =>
      notify('Some map tiles could not load. Try refreshing your connection.'),
    );
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.facilityLayer = (
      L.markerClusterGroup
        ? L.markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 50,
            iconCreateFunction: (cluster) =>
              L.divIcon({
                className: 'facility-cluster',
                html: `<span>${cluster.getChildCount()}</span>`,
                iconSize: [42, 42],
              }),
          })
        : L.layerGroup()
    ).addTo(this.map);
    this.stopLayer = L.layerGroup().addTo(this.map);
    this.selectionLayer = L.layerGroup().addTo(this.map);
    this.onFacilityClick = onFacilityClick;
    this.map.on('click', (event) => onMapClick(event.latlng));
  }

  showFacilities(facilities, clustered = true) {
    if (!this.map) return;
    this.facilityLayer.clearLayers();
    this.selectionLayer.clearLayers();
    for (const facility of facilities) this.addFacility(facility, clustered);
  }

  addFacility(facility, clustered = true) {
    if (!this.map) return;
    const communityClass = facility.source === 'Community' ? 'community' : '';
    const marker = L.marker([facility.lat, facility.lng], {
      title: `${facility.name} (${facility.type})`,
      icon: L.divIcon({
        className: 'facility-marker',
        html: `<div class="marker-inner ${facility.type} ${communityClass}">${icon(facility.type)}</div>${facility.openReports ? '<span class="marker-issue">!</span>' : ''}`,
        iconSize: [34, 38],
        iconAnchor: [17, 38],
      }),
    });
    marker.on('click', () => this.onFacilityClick(facility));
    marker.addTo(clustered ? this.facilityLayer : this.selectionLayer);
  }

  frameChoices(facilities, origin) {
    if (!this.map || !facilities.length) return;
    const points = [origin, ...facilities].map((point) => [point.lat, point.lng]);
    this.map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [50, 90],
      paddingBottomRight: [50, 180],
      maxZoom: 17,
    });
  }

  showRadius(visible) {
    if (!this.map || !this.radiusCircle) return;
    if (visible) this.radiusCircle.addTo(this.map);
    else this.map.removeLayer(this.radiusCircle);
  }

  setCenter(point, radius, label) {
    if (!this.map) return;
    if (this.originMarker) this.map.removeLayer(this.originMarker);
    if (this.radiusCircle) this.map.removeLayer(this.radiusCircle);
    this.originMarker = L.marker([point.lat, point.lng], {
      title: label,
      icon: L.divIcon({
        className: 'origin-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    })
      .addTo(this.map)
      .bindTooltip(label);
    this.radiusCircle = L.circle([point.lat, point.lng], {
      radius,
      color: '#697e65',
      weight: 1,
      fillOpacity: 0.025,
      interactive: false,
    }).addTo(this.map);
    this.map.setView([point.lat, point.lng], 14);
  }

  focus(point) {
    this.map?.setView([point.lat, point.lng], 17);
  }

  showStops(stops) {
    if (!this.map) return;
    this.stopLayer.clearLayers();
    stops.forEach((stop, index) => {
      L.marker([stop.lat, stop.lng], {
        title: `Stop ${index + 1}: ${stop.name}`,
        icon: L.divIcon({
          className: 'stop-marker',
          html: String(index + 1),
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      }).addTo(this.stopLayer);
    });
  }

  clearRoute() {
    if (this.routeLayer && this.map) this.map.removeLayer(this.routeLayer);
  }

  showRoute(route) {
    if (!this.map) return;
    this.clearRoute();
    this.routeLayer = L.geoJSON(route.geometry, {
      style: { color: '#ef5c27', weight: 6, opacity: 0.9 },
    }).addTo(this.map);
    // Leave room above the route for the back button and zoom controls.
    this.map.fitBounds(this.routeLayer.getBounds(), {
      paddingTopLeft: [45, 90],
      paddingBottomRight: [45, 45],
    });
  }

  setPicking(enabled) {
    if (this.map) this.map.getContainer().style.cursor = enabled ? 'crosshair' : '';
  }
}
