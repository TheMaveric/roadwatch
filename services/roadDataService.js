const ROAD_SOURCES = [
  {
    name: 'OpenStreetMap Overpass (India highway network)',
    type: 'gis',
    enabled: Boolean(process.env.ENABLE_LIVE_GIS === 'true'),
    priority: 1,
    url: 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(`
      [out:json][timeout:25];
      (
        way[highway](6.7,68.4,37.1,97.4);
      );
      out geom;
    `),
  },
  {
    name: 'Government GIS endpoint (configure via env vars)',
    type: 'government',
    enabled: Boolean(process.env.GOVERNMENT_GIS_URL),
    priority: 2,
    url: process.env.GOVERNMENT_GIS_URL || '',
  },
  {
    name: 'Road maintenance feed (configure via env vars)',
    type: 'maintenance',
    enabled: Boolean(process.env.ROAD_MAINTENANCE_URL),
    priority: 3,
    url: process.env.ROAD_MAINTENANCE_URL || '',
  },
];

const highwayLabel = {
  motorway: 'Expressway',
  trunk: 'National Highway',
  primary: 'National Highway',
  secondary: 'State Highway',
  tertiary: 'Regional Road',
  residential: 'Urban Road',
  unclassified: 'Local Road',
  service: 'Access Road',
  track: 'Rural Road',
  path: 'Trail',
};

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const geometryLengthKm = (geometry) => {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;

  const radians = (degrees) => (degrees * Math.PI) / 180;
  let distance = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const previous = geometry[index - 1];
    const current = geometry[index];
    const lat1 = radians(safeNumber(previous.lat));
    const lat2 = radians(safeNumber(current.lat));
    const deltaLat = lat2 - lat1;
    const deltaLng = radians(safeNumber(current.lon) - safeNumber(previous.lon));
    const haversine = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    distance += 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }
  return Number(distance.toFixed(2));
};

const computeCenterFromGeometry = (geometry) => {
  if (!Array.isArray(geometry) || !geometry.length) return { lat: 0, lng: 0 };

  const latSum = geometry.reduce((sum, point) => sum + safeNumber(point.lat, 0), 0);
  const lngSum = geometry.reduce((sum, point) => sum + safeNumber(point.lon, 0), 0);

  return {
    lat: latSum / geometry.length,
    lng: lngSum / geometry.length,
  };
};

const normalizeRoad = (raw, sourceName) => {
  const tags = raw.tags || {};
  const name = tags.name || `Road-${raw.id}`;
  const roadType = highwayLabel[tags.highway] || 'Road';
  const geometryCenter = computeCenterFromGeometry(raw.geometry);
  const lat = safeNumber(raw.center?.lat ?? raw.lat ?? geometryCenter.lat, 0);
  const lng = safeNumber(raw.center?.lon ?? raw.lon ?? geometryCenter.lng, 0);

  return {
    id: `external-${sourceName}-${raw.id}`,
    name,
    area: tags['addr:state'] || tags.state || 'Not specified',
    condition: 'Unverified',
    roadType,
    sizeKm: geometryLengthKm(raw.geometry),
    contractor: null,
    validityMonths: null,
    constructionCost: null,
    costEstimate: null,
    contractId: null,
    potholeCount: null,
    lastInspection: null,
    lat,
    lng,
    geometry: Array.isArray(raw.geometry)
      ? raw.geometry.map((point) => [safeNumber(point.lat), safeNumber(point.lon)])
      : [],
    source: sourceName,
    external: true,
  };
};

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpassIndiaRoads() {
  const query = `
    [out:json][timeout:25];
    (
      way[highway](6.7,68.4,37.1,97.4);
    );
    out geom;
  `;

  const data = await fetchJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, 7000);
  const ways = Array.isArray(data.elements) ? data.elements.filter((element) => element.type === 'way') : [];

  return ways
    .filter((way) => way.tags && way.tags.highway)
    .map((way) => normalizeRoad(way, 'OpenStreetMap Overpass'))
    .filter((road) => road.lat !== 0 || road.lng !== 0);
}

async function fetchProviderRoads(provider) {
  if (!provider.enabled || !provider.url) {
    return [];
  }

  if (provider.name.includes('OpenStreetMap')) {
    return fetchOverpassIndiaRoads();
  }

  const data = await fetchJson(provider.url, 7000);
  const items = Array.isArray(data) ? data : data.features || data.results || [];

  return items.map((item) => {
    const coordinates = item.geometry?.coordinates;
    const geometry = Array.isArray(coordinates) && typeof coordinates[0] === 'number'
      ? [{ lat: coordinates[1], lon: coordinates[0] }]
      : Array.isArray(coordinates)
        ? coordinates.map(([lon, lat]) => ({ lat, lon }))
        : item.geometry;

    return normalizeRoad({
      ...item,
      id: item.id || item.road_id || item.name || 'unknown',
      tags: item.tags || {},
      geometry,
      center: item.center || (Array.isArray(coordinates) && typeof coordinates[0] === 'number'
        ? { lat: coordinates[1], lon: coordinates[0] }
        : undefined),
    }, provider.name);
  });
}

async function fetchRoadNetwork() {
  const orderedSources = [...ROAD_SOURCES].sort((a, b) => a.priority - b.priority);

  for (const provider of orderedSources) {
    if (!provider.enabled) continue;

    try {
      const roads = await fetchProviderRoads(provider);
      if (roads.length) {
        return roads;
      }
    } catch (error) {
      console.warn(`Road source failed: ${provider.name}`, error.message);
    }
  }

  return [];
}

function listSources() {
  return ROAD_SOURCES.map((provider) => ({
    name: provider.name,
    type: provider.type,
    enabled: provider.enabled,
    priority: provider.priority,
    url: provider.url || null,
  }));
}

module.exports = {
  fetchRoadNetwork,
  listSources,
  ROAD_SOURCES,
};
