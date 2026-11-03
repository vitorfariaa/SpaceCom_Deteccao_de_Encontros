export const EARTH_RADIUS_METERS = 6_371_000;
export const ENCOUNTER_RADIUS_METERS = 20;
export const DEG_TO_RAD = Math.PI / 180;
export const LATITUDE_WINDOW = ENCOUNTER_RADIUS_METERS / EARTH_RADIUS_METERS / DEG_TO_RAD;

// calcula a distancia em metros sem arredondar
export function haversineMeters(a, b) {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const sinLat = Math.sin((b.lat - a.lat) * DEG_TO_RAD / 2);
  const sinLon = Math.sin((b.lon - a.lon) * DEG_TO_RAD / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}

// divide o espaco em cubos de 20 metros com a terra no centro
export function earthCell(point) {
  const lat = point.lat * DEG_TO_RAD;
  const lon = point.lon * DEG_TO_RAD;
  const scale = EARTH_RADIUS_METERS / ENCOUNTER_RADIUS_METERS;
  const horizontal = scale * Math.cos(lat);
  return [
    Math.floor(horizontal * Math.cos(lon)),
    Math.floor(horizontal * Math.sin(lon)),
    Math.floor(scale * Math.sin(lat)),
  ];
}
