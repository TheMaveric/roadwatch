const totalRoadsEl = document.getElementById('totalRoads');
const totalCostEl = document.getElementById('totalCost');
const avgValidityEl = document.getElementById('avgValidity');
const severeRoadsEl = document.getElementById('severeRoads');
const totalRoadKmEl = document.getElementById('totalRoadKm');
const avgCostPerKmEl = document.getElementById('avgCostPerKm');
const contractorListEl = document.getElementById('contractorList');
const roadTableBodyEl = document.getElementById('roadTableBody');
const conditionFilterEl = document.getElementById('conditionFilter');
const roadSearchEl = document.getElementById('roadSearch');
const form = document.getElementById('roadForm');
const mapStatusEl = document.getElementById('mapStatus');
const tableCountEl = document.getElementById('tableCount');
const adminLoginForm = document.getElementById('adminLoginForm');
const logoutBtn = document.getElementById('logoutBtn');
const exportExcelBtn = document.getElementById('exportExcelBtn');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const zoomToIndiaBtn = document.getElementById('zoomToIndia');
const zoomToKarnatakaBtn = document.getElementById('zoomToKarnataka');
const locateMeBtn = document.getElementById('locateMe');
const sidebarToggleBtn = document.getElementById('toggleSidebar');
const mobileSidebarToggleBtn = document.getElementById('mobileSidebarToggle');
const sidebarToggleButtons = [sidebarToggleBtn, mobileSidebarToggleBtn];
const registerToggleBtn = document.getElementById('toggleRegister');
const dashboardGridEl = document.getElementById('dashboardGrid');
const sourceToggleBtn = document.getElementById('toggleSources');
const closeSourcesBtn = document.getElementById('closeSources');
const sourceDeskEl = document.getElementById('sourceDesk');
const sourceListEl = document.getElementById('sourceList');
const storageStatusEl = document.getElementById('storageStatus');
const highwaysToggleBtn = document.getElementById('toggleHighways');
const nhaiProjectsToggleBtn = document.getElementById('toggleNhaiProjects');
const conditionReportsToggleBtn = document.getElementById('toggleConditionReports');
const localRoadsToggleBtn = document.getElementById('toggleLocalRoads');
const pmgsyToggleBtn = document.getElementById('togglePmgsyDesk');
const pmgsyDeskEl = document.getElementById('pmgsyDesk');
const closePmgsyDeskBtn = document.getElementById('closePmgsyDesk');
const pmgsyStateEl = document.getElementById('pmgsyState');
const pmgsyDistrictEl = document.getElementById('pmgsyDistrict');
const pmgsyBlockEl = document.getElementById('pmgsyBlock');
const pmgsyRoadEl = document.getElementById('pmgsyRoad');
const pmgsyStatusEl = document.getElementById('pmgsyStatus');
const pmgsyDetailsEl = document.getElementById('pmgsyDetails');

const indiaBounds = [[68.1, 6.7], [97.4, 37.1]];
const highwayArchiveUrl = 'https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/infra/national-highways/GatiShakti_MORTH_National_Highways.pmtiles';
const stateBoundariesArchiveUrl = 'https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/admin/states/LGD_States.pmtiles';
const karnatakaViewBounds = [[74.0, 11.5], [78.6, 18.5]];
const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  bounds: indiaBounds,
  fitBoundsOptions: { padding: 26 },
  minZoom: 2,
  maxZoom: 18,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

let allRoads = [];
let mapReady = false;
let roadsFitted = false;
let showHighways = true;
let showCommunityRoads = true;
let showLocalRoads = true;
let showConditionReports = true;
let showNhaiProjects = false;
let communityRoadLayerIds = [];
let localRoadLayerIds = [];
let conditionReportFeatures = { type: 'FeatureCollection', features: [] };
let conditionRoadSegmentDataKey = '';
let nhaiProjectFeatures = { type: 'FeatureCollection', features: [] };
let nhaiProjectRequestId = 0;
let nhaiProjectMoveTimer = null;
let nhaiProjectBoundsKey = '';
let nearbyNhaiDataStatus = 'idle';
let userLocationMarker = null;
let nearbyRoadPopup = null;
let nearbyRoadPopupTimer = null;
let pmgsyStatesLoaded = false;
const nearbyRoadSearchRadiusMeters = 1000;
const mobileLayoutQuery = window.matchMedia('(max-width: 1100px)');
if (mobileLayoutQuery.matches) {
  document.body.classList.add('sidebar-closed');
}
sidebarToggleButtons.forEach((button) => {
  button.setAttribute('aria-expanded', String(!document.body.classList.contains('sidebar-closed')));
});
if (mobileLayoutQuery.addEventListener) {
  mobileLayoutQuery.addEventListener('change', (event) => {
    document.body.classList.toggle('sidebar-closed', event.matches);
    sidebarToggleButtons.forEach((button) => {
      button.setAttribute('aria-expanded', String(!event.matches));
    });
    map.resize();
  });
}

const conditionRatingDescriptions = {
  1: ['Best', 'Smooth and comfortable; no noticeable defects.'],
  2: ['Good', 'Generally sound; only minor wear.'],
  3: ['Bad', 'Noticeable defects affect the ride.'],
  4: ['Worse', 'Major damage or potholes make travel difficult.'],
  5: ['Worst', 'Unsafe or impassable; needs urgent attention.'],
};

const showMapStatus = (message, type = 'error') => {
  mapStatusEl.textContent = message;
  mapStatusEl.classList.remove('hidden', 'error', 'success');
  mapStatusEl.classList.add(type);
};

const clearMapStatus = () => {
  mapStatusEl.textContent = '';
  mapStatusEl.classList.add('hidden');
  mapStatusEl.classList.remove('error', 'success');
};

const distanceBetweenCoordinates = ([lngA, latA], [lngB, latB]) => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(latB - latA);
  const longitudeDelta = radians(lngB - lngA);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const nearestPointOnLine = (coordinates, origin) => {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.cos(origin[1] * Math.PI / 180);
  const toLocal = ([longitude, latitude]) => [
    (longitude - origin[0]) * longitudeScale,
    (latitude - origin[1]) * latitudeScale,
  ];
  const originPoint = [0, 0];
  let nearest = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = toLocal(coordinates[index - 1]);
    const end = toLocal(coordinates[index]);
    const segment = [end[0] - start[0], end[1] - start[1]];
    const lengthSquared = segment[0] ** 2 + segment[1] ** 2;
    const proportion = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((originPoint[0] - start[0]) * segment[0]
        + (originPoint[1] - start[1]) * segment[1]) / lengthSquared));
    const nearestLocal = [
      start[0] + segment[0] * proportion,
      start[1] + segment[1] * proportion,
    ];
    const distanceMeters = Math.hypot(nearestLocal[0], nearestLocal[1]);
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = {
        distanceMeters,
        coordinates: [
          origin[0] + nearestLocal[0] / longitudeScale,
          origin[1] + nearestLocal[1] / latitudeScale,
        ],
      };
    }
  }
  return nearest;
};

const getFeatureDistance = (feature, origin) => {
  const geometry = feature.geometry;
  if (!geometry) return null;
  const coordinates = geometry.type === 'LineString'
    ? [geometry.coordinates]
    : geometry.type === 'MultiLineString'
      ? geometry.coordinates
      : [];
  return coordinates
    .map((line) => nearestPointOnLine(line, origin))
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)[0] || null;
};

const clipRoadLineAtReport = (coordinates, origin, halfLengthMeters = 65) => {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.cos(origin[1] * Math.PI / 180);
  const localCoordinates = coordinates.map(([longitude, latitude]) => [
    (longitude - origin[0]) * longitudeScale,
    (latitude - origin[1]) * latitudeScale,
  ]);
  const distances = [0];
  for (let index = 1; index < localCoordinates.length; index += 1) {
    distances.push(distances[index - 1] + Math.hypot(
      localCoordinates[index][0] - localCoordinates[index - 1][0],
      localCoordinates[index][1] - localCoordinates[index - 1][1],
    ));
  }

  let nearest = null;
  for (let index = 1; index < localCoordinates.length; index += 1) {
    const start = localCoordinates[index - 1];
    const end = localCoordinates[index];
    const segment = [end[0] - start[0], end[1] - start[1]];
    const length = distances[index] - distances[index - 1];
    const proportion = length === 0
      ? 0
      : Math.max(0, Math.min(1, -(start[0] * segment[0] + start[1] * segment[1]) / length ** 2));
    const distanceMeters = Math.hypot(
      start[0] + segment[0] * proportion,
      start[1] + segment[1] * proportion,
    );
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = {
        distanceMeters,
        alongMeters: distances[index - 1] + length * proportion,
      };
    }
  }
  if (!nearest || nearest.distanceMeters > 30) return null;

  const startMeters = Math.max(0, nearest.alongMeters - halfLengthMeters);
  const endMeters = Math.min(distances[distances.length - 1], nearest.alongMeters + halfLengthMeters);
  const coordinateAt = (distanceMeters) => {
    const segmentIndex = distances.findIndex((distance, index) => index > 0 && distance >= distanceMeters);
    if (segmentIndex < 0) return coordinates[coordinates.length - 1];
    const segmentLength = distances[segmentIndex] - distances[segmentIndex - 1];
    const proportion = segmentLength === 0
      ? 0
      : (distanceMeters - distances[segmentIndex - 1]) / segmentLength;
    return [
      coordinates[segmentIndex - 1][0]
        + (coordinates[segmentIndex][0] - coordinates[segmentIndex - 1][0]) * proportion,
      coordinates[segmentIndex - 1][1]
        + (coordinates[segmentIndex][1] - coordinates[segmentIndex - 1][1]) * proportion,
    ];
  };
  const clipped = [coordinateAt(startMeters)];
  coordinates.forEach((coordinate, index) => {
    if (distances[index] > startMeters && distances[index] < endMeters) clipped.push(coordinate);
  });
  clipped.push(coordinateAt(endMeters));
  return clipped.length > 1 ? clipped : null;
};

const getNearbyMapRoads = (coordinates) => {
  if (!communityRoadLayerIds.length || !showCommunityRoads) return [];
  const layerIds = communityRoadLayerIds.filter((layerId) => {
    const layer = map.getLayer(layerId);
    return layer?.type === 'line'
      && !layerId.includes('casing')
      && map.getLayoutProperty(layerId, 'visibility') !== 'none';
  });
  if (!layerIds.length) return [];

  const mapPoint = map.project(coordinates);
  const mapWidth = map.getContainer().clientWidth;
  const mapHeight = map.getContainer().clientHeight;
  const metersPerPixel = 40_075_016.686 * Math.cos(coordinates[1] * Math.PI / 180)
    / (512 * 2 ** map.getZoom());
  const radiusPixels = nearbyRoadSearchRadiusMeters / metersPerPixel;
  const features = map.queryRenderedFeatures([
    [Math.max(0, mapPoint.x - radiusPixels), Math.max(0, mapPoint.y - radiusPixels)],
    [Math.min(mapWidth, mapPoint.x + radiusPixels), Math.min(mapHeight, mapPoint.y + radiusPixels)],
  ], { layers: layerIds });
  const roadsById = new Map();
  features.forEach((feature) => {
    const nearest = getFeatureDistance(feature, coordinates);
    if (!nearest || nearest.distanceMeters > nearbyRoadSearchRadiusMeters) return;
    const properties = feature.properties || {};
    const roadClass = properties.class || 'road';
    const key = feature.id === undefined
      ? `${properties.name || roadClass}:${roadClass}:${Math.round(nearest.coordinates[0] * 10000)}:${Math.round(nearest.coordinates[1] * 10000)}`
      : String(feature.id);
    const existing = roadsById.get(key);
    if (existing && existing.distanceMeters <= nearest.distanceMeters) return;
    roadsById.set(key, {
      id: feature.id === undefined ? null : String(feature.id),
      name: properties.name || '',
      roadClass,
      surface: properties.surface || null,
      smoothness: properties.smoothness || null,
      distanceMeters: nearest.distanceMeters,
    });
  });
  return Array.from(roadsById.values())
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, 50);
};

const getNearbyVerifiedRoadRecords = (coordinates) => allRoads
  .map((road) => {
    const recordCoordinates = Number.isFinite(Number(road.lng)) && Number.isFinite(Number(road.lat))
      ? [Number(road.lng), Number(road.lat)]
      : null;
    return recordCoordinates
      ? { road, distanceMeters: distanceBetweenCoordinates(coordinates, recordCoordinates) }
      : null;
  })
  .filter((record) => record && record.distanceMeters <= nearbyRoadSearchRadiusMeters)
  .sort((left, right) => left.distanceMeters - right.distanceMeters)
  .slice(0, 50);

const getNearbyConditionReports = (coordinates) => showConditionReports
  ? conditionReportFeatures.features
    .map((feature) => ({
      feature,
      distanceMeters: distanceBetweenCoordinates(coordinates, feature.geometry.coordinates),
    }))
    .filter((report) => report.distanceMeters <= nearbyRoadSearchRadiusMeters)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, 8)
  : [];

const getNearbyNhaiProjects = (coordinates) => nhaiProjectFeatures.features
  .map((feature) => ({
    feature,
    nearest: getFeatureDistance(feature, coordinates),
  }))
  .filter((project) => project.nearest && project.nearest.distanceMeters <= nearbyRoadSearchRadiusMeters)
  .sort((left, right) => left.nearest.distanceMeters - right.nearest.distanceMeters)
  .slice(0, 10);

const addPopupDetail = (parent, label, value) => {
  const detail = document.createElement('p');
  detail.className = 'nearby-road-detail';
  const labelElement = document.createElement('strong');
  labelElement.textContent = `${label}: `;
  const displayValue = value === null || value === undefined || value === ''
    ? 'Not available from connected sources'
    : String(value);
  detail.append(labelElement, document.createTextNode(displayValue));
  parent.appendChild(detail);
};

const normalizePmgsyAreaName = (name) => String(name || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/\b(district|block|taluk(?:a|u)?|tehsil|subdistrict)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const findPmgsyAreaMatch = (records, candidates) => {
  const names = new Set(candidates.map(normalizePmgsyAreaName).filter(Boolean));
  const aliases = new Map([
    ['kerala', 'keralam'],
    ['orissa', 'odisha'],
    ['bagalkote', 'bagalkot'],
  ]);
  for (const record of records) {
    const name = normalizePmgsyAreaName(record.name);
    if (names.has(name) || [...names].some((candidate) => aliases.get(candidate) === name
      || aliases.get(name) === candidate)) return record;
  }
  return null;
};

const fetchPmgsyRecords = async (path) => {
  const response = await fetch(path);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Unable to load PMGSY records.');
  return result;
};

const createPmgsyAreaSelect = (labelText, placeholder) => {
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  select.setAttribute('aria-label', labelText);
  select.appendChild(new Option(placeholder, ''));
  label.appendChild(select);
  return { label, select };
};

const renderNearbyPmgsyDetails = (parent, details) => {
  parent.replaceChildren();
  parent.classList.add('nearby-road-card', 'verified-nearby-road');
  const heading = document.createElement('strong');
  heading.textContent = details.roadName || 'PMGSY road record';
  parent.appendChild(heading);
  addPopupDetail(parent, 'Package', details.packageNo);
  addPopupDetail(parent, 'Contractor', details.contractor);
  addPopupDetail(parent, 'Road length', details.lengthKm === null ? null : `${details.lengthKm} km`);
  addPopupDetail(parent, 'Maintenance period', details.maintenanceStartDate || details.maintenanceEndDate
    ? `${details.maintenanceStartDate || 'Start not listed'} – ${details.maintenanceEndDate || 'End not listed'}`
    : null);
  addPopupDetail(parent, 'eMARG maintenance expenditure', details.maintenanceExpenditureRupees === null
    ? null
    : formatCurrency(details.maintenanceExpenditureRupees));
  addPopupDetail(parent, 'eMARG inspection mark', details.inspectionMark);
  addPopupDetail(parent, 'Construction award cost', 'Not provided by this eMARG record');
  const source = document.createElement('a');
  source.href = details.sourceUrl;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.textContent = 'Open official eMARG record ↗';
  parent.appendChild(source);
};

const loadNearbyPmgsyArea = async (coordinates, panel) => {
  const status = panel.querySelector('.nearby-pmgsy-status');
  const controls = panel.querySelector('.nearby-pmgsy-controls');
  const [stateField, districtField, blockField, roadField] = [
    ['State / UT', 'Choose state'],
    ['District', 'Choose district'],
    ['Block', 'Choose block'],
    ['PMGSY road', 'Choose a road record'],
  ].map(([label, placeholder]) => createPmgsyAreaSelect(label, placeholder));
  const stateSelect = stateField.select;
  const districtSelect = districtField.select;
  const blockSelect = blockField.select;
  const roadSelect = roadField.select;
  const detailButton = document.createElement('button');
  detailButton.type = 'button';
  detailButton.className = 'map-action nearby-pmgsy-detail-button';
  detailButton.textContent = 'View selected record';
  detailButton.disabled = true;
  const recordDetails = document.createElement('div');
  recordDetails.className = 'nearby-pmgsy-record-details';
  controls.replaceChildren(stateField.label, districtField.label, blockField.label, roadField.label, detailButton, recordDetails);

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  const resetSelect = (select, placeholder) => {
    select.replaceChildren(new Option(placeholder, ''));
    select.disabled = true;
  };

  const populateSelect = (select, placeholder, records) => {
    select.replaceChildren(
      new Option(placeholder, ''),
      ...records.map((record) => new Option(record.name, record.id)),
    );
    select.disabled = records.length === 0;
  };

  const loadRoads = async () => {
    resetSelect(roadSelect, 'Choose a road record');
    detailButton.disabled = true;
    recordDetails.replaceChildren();
    if (!districtSelect.value || !blockSelect.value) return;
    const result = await fetchPmgsyRecords(`/api/pmgsy/roads?${new URLSearchParams({
      district: districtSelect.value,
      block: blockSelect.value,
    })}`);
    populateSelect(roadSelect, 'Choose a road record', result.roads);
    setStatus(result.roads.length
      ? `${result.roads.length}${result.truncated ? '+' : ''} PMGSY records listed for ${blockSelect.selectedOptions[0].textContent}, ${districtSelect.selectedOptions[0].textContent}. These are area records, not verified nearest-road matches.`
      : 'No PMGSY roads are listed for this block.');
  };

  const loadBlocks = async (districtId, localityCandidates = []) => {
    resetSelect(blockSelect, 'Choose block');
    resetSelect(roadSelect, 'Choose a road record');
    detailButton.disabled = true;
    recordDetails.replaceChildren();
    if (!districtId) return;
    const blocks = await fetchPmgsyRecords(`/api/pmgsy/blocks?district=${encodeURIComponent(districtId)}`);
    populateSelect(blockSelect, 'Choose block', blocks);
    const match = findPmgsyAreaMatch(blocks, localityCandidates);
    if (match) {
      blockSelect.value = match.id;
      await loadRoads();
    } else {
      setStatus('Area identified. Choose a block to browse its PMGSY records; eMARG does not provide road coordinates for nearest-road matching.');
    }
  };

  const loadDistricts = async (stateId, districtCandidates = [], localityCandidates = []) => {
    resetSelect(districtSelect, 'Choose district');
    resetSelect(blockSelect, 'Choose block');
    resetSelect(roadSelect, 'Choose a road record');
    detailButton.disabled = true;
    recordDetails.replaceChildren();
    if (!stateId) return;
    const districts = await fetchPmgsyRecords(`/api/pmgsy/districts?state=${encodeURIComponent(stateId)}`);
    populateSelect(districtSelect, 'Choose district', districts);
    const match = findPmgsyAreaMatch(districts, districtCandidates);
    if (match) {
      districtSelect.value = match.id;
      await loadBlocks(match.id, localityCandidates);
    } else {
      setStatus('State identified. Choose a district and block to browse the official PMGSY records for that area.');
    }
  };

  stateSelect.addEventListener('change', async () => {
    try {
      setStatus('Loading districts…');
      await loadDistricts(stateSelect.value);
      if (!stateSelect.value) setStatus('Choose a state, district, and block to browse PMGSY records.');
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  districtSelect.addEventListener('change', async () => {
    try {
      setStatus('Loading blocks…');
      await loadBlocks(districtSelect.value);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  blockSelect.addEventListener('change', async () => {
    try {
      setStatus('Loading PMGSY road list…');
      await loadRoads();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  roadSelect.addEventListener('change', () => {
    detailButton.disabled = !roadSelect.value;
    recordDetails.replaceChildren();
  });
  detailButton.addEventListener('click', async () => {
    if (!roadSelect.value) return;
    detailButton.disabled = true;
    detailButton.textContent = 'Loading official record…';
    try {
      const details = await fetchPmgsyRecords(`/api/pmgsy/road/${encodeURIComponent(roadSelect.value)}`);
      renderNearbyPmgsyDetails(recordDetails, details);
      setStatus('Official eMARG details loaded. Record location is only known to the selected administrative area.');
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      detailButton.disabled = !roadSelect.value;
      detailButton.textContent = 'View selected record';
    }
  });

  setStatus('Finding the administrative area and matching PMGSY lists…');
  controls.classList.remove('hidden');
  try {
    const [area, states] = await Promise.all([
      fetchPmgsyRecords(`/api/pmgsy/location?${new URLSearchParams({
        lat: String(coordinates[1]),
        lng: String(coordinates[0]),
      })}`),
      fetchPmgsyRecords('/api/pmgsy/states'),
    ]);
    populateSelect(stateSelect, 'Choose state', states);
    const stateMatch = findPmgsyAreaMatch(states, [area.state]);
    if (!stateMatch || !area.matched) {
      setStatus('Could not confidently identify a PMGSY state and district here. Select the administrative area to browse records; selection does not establish a road match.');
      return;
    }
    stateSelect.value = stateMatch.id;
    const localityCandidates = area.localityCandidates || [];
    await loadDistricts(stateMatch.id, [area.district], localityCandidates);
  } catch (error) {
    setStatus(error.message, true);
  }
};

const renderNearbyRoadPopup = (coordinates) => {
  const content = document.createElement('div');
  content.className = 'nearby-roads-popup';
  const heading = document.createElement('strong');
  heading.className = 'nearby-roads-heading';
  heading.textContent = 'Roads near your location · 1 km';
  content.appendChild(heading);

  const summary = document.createElement('p');
  summary.className = 'nearby-roads-intro';
  summary.textContent = 'Mapped roads come from OpenStreetMap. Contract records are shown separately only when a verified register record is nearby; nearby does not prove it belongs to a mapped line.';
  content.appendChild(summary);

  const pmgsyPanel = document.createElement('section');
  pmgsyPanel.className = 'nearby-pmgsy-panel';
  const pmgsyHeading = document.createElement('strong');
  pmgsyHeading.className = 'nearby-roads-section-heading';
  pmgsyHeading.textContent = 'PMGSY rural road records';
  pmgsyPanel.appendChild(pmgsyHeading);
  const pmgsyNotice = document.createElement('p');
  pmgsyNotice.className = 'nearby-road-detail';
  pmgsyNotice.textContent = 'Search eMARG records for this administrative area. Records have no road coordinates, so they cannot be identified as the nearest road or matched to an OSM line.';
  pmgsyPanel.appendChild(pmgsyNotice);
  const pmgsySearchButton = document.createElement('button');
  pmgsySearchButton.type = 'button';
  pmgsySearchButton.className = 'map-action nearby-pmgsy-search';
  pmgsySearchButton.textContent = 'Find PMGSY records in this area';
  pmgsyPanel.appendChild(pmgsySearchButton);
  const pmgsyStatus = document.createElement('p');
  pmgsyStatus.className = 'nearby-pmgsy-status nearby-road-detail';
  pmgsyStatus.setAttribute('role', 'status');
  pmgsyStatus.setAttribute('aria-live', 'polite');
  pmgsyPanel.appendChild(pmgsyStatus);
  const pmgsyControls = document.createElement('div');
  pmgsyControls.className = 'nearby-pmgsy-controls hidden';
  pmgsyPanel.appendChild(pmgsyControls);
  pmgsySearchButton.addEventListener('click', async () => {
    pmgsySearchButton.disabled = true;
    pmgsySearchButton.textContent = 'Finding PMGSY area…';
    await loadNearbyPmgsyArea(coordinates, pmgsyPanel);
    pmgsySearchButton.disabled = false;
    pmgsySearchButton.textContent = 'Refresh PMGSY area records';
  });
  content.appendChild(pmgsyPanel);

  const mappedRoads = getNearbyMapRoads(coordinates);
  if (mappedRoads.length) {
    const sectionHeading = document.createElement('strong');
    sectionHeading.className = 'nearby-roads-section-heading';
    sectionHeading.textContent = `Mapped roads nearby (${mappedRoads.length}${mappedRoads.length === 50 ? '+' : ''})`;
    content.appendChild(sectionHeading);
    mappedRoads.forEach((road) => {
      const card = document.createElement('article');
      card.className = 'nearby-road-card';
      const roadHeading = document.createElement('strong');
      roadHeading.textContent = road.name || `Unnamed ${road.roadClass.replaceAll('_', ' ')} road`;
      card.appendChild(roadHeading);
      addPopupDetail(card, 'Road class', road.roadClass.replaceAll('_', ' '));
      addPopupDetail(card, 'Distance', `${Math.round(road.distanceMeters)} m`);
      if (road.surface) addPopupDetail(card, 'Mapped surface', road.surface);
      if (road.smoothness) addPopupDetail(card, 'Mapped smoothness', road.smoothness);

      const linkedReports = road.id
        ? conditionReportFeatures.features.filter((report) => report.properties.osmWayId === road.id)
        : [];
      const condition = linkedReports.length
        ? linkedReports.map((report) => `${report.properties.ratingLabel} · ${report.properties.reportCount} community ${Number(report.properties.reportCount) === 1 ? 'report' : 'reports'}`).join('; ')
        : 'No community condition report linked to this mapped road';
      addPopupDetail(card, 'Condition', condition);
      addPopupDetail(card, 'Contractor', 'Not available from connected sources');
      addPopupDetail(card, 'Construction price', 'Not available from connected sources');
      addPopupDetail(card, 'Guarantee / maintenance period', 'Not available from connected sources');
      addPopupDetail(card, 'Built / repaired dates', 'Not available from connected sources');
      content.appendChild(card);
    });
  } else {
    const message = document.createElement('p');
    message.textContent = showCommunityRoads
      ? 'No mapped road lines were available in the visible map tiles within 1 km.'
      : 'Turn on OSM roads to list mapped roads near this location.';
    content.appendChild(message);
  }

  const nearbyProjects = getNearbyNhaiProjects(coordinates);
  if (nearbyProjects.length || nearbyNhaiDataStatus !== 'idle') {
    const sectionHeading = document.createElement('strong');
    sectionHeading.className = 'nearby-roads-section-heading';
    sectionHeading.textContent = 'NHAI project packages nearby';
    content.appendChild(sectionHeading);
    nearbyProjects.forEach(({ feature, nearest }) => {
      const properties = feature.properties || {};
      const card = document.createElement('article');
      card.className = 'nearby-road-card verified-nearby-road';
      const projectHeading = document.createElement('strong');
      projectHeading.textContent = properties.project_na || properties.adv_project_name || 'NHAI project';
      card.appendChild(projectHeading);
      addPopupDetail(card, 'Package', properties.adv_pkg_name || properties.upc);
      addPopupDetail(card, 'Distance', `${Math.round(nearest.distanceMeters)} m`);
      addPopupDetail(card, 'Portal capital cost', properties.adv_total_capital_cost !== null
        && properties.adv_total_capital_cost !== undefined
        && properties.adv_total_capital_cost !== ''
        ? `₹${properties.adv_total_capital_cost} crore; not necessarily final awarded or paid value`
        : null);
      addPopupDetail(card, 'Delivery mode', properties.mode);
      addPopupDetail(card, 'Status', properties.current_st);
      addPopupDetail(card, 'Physical progress', properties.adv_cumphysical_progress_tilllastmonth !== null
        && properties.adv_cumphysical_progress_tilllastmonth !== undefined
        && properties.adv_cumphysical_progress_tilllastmonth !== ''
        ? `${properties.adv_cumphysical_progress_tilllastmonth}%`
        : null);
      addPopupDetail(card, 'Appointed / scheduled completion', [
        properties.adv_appointed_date,
        properties.adv_scheduled_completion_date,
      ].filter(Boolean).join(' / '));
      addPopupDetail(card, 'Contractor', 'Not identified by this NHAI GIS field');
      addPopupDetail(card, 'Guarantee / maintenance period', 'Not available from this NHAI GIS record');
      content.appendChild(card);
    });
    if (!nearbyProjects.length) {
      const status = document.createElement('p');
      status.className = 'nearby-road-detail';
      status.textContent = nearbyNhaiDataStatus === 'loading'
        ? 'Checking live NHAI project alignments for this area…'
        : nearbyNhaiDataStatus === 'error'
          ? 'Live NHAI project data could not be loaded. Try again by moving the map or toggling NHAI projects.'
          : 'No NHAI project alignment was returned within 1 km in the loaded area.';
      content.appendChild(status);
    }
  }

  const verifiedRecords = getNearbyVerifiedRoadRecords(coordinates);
  if (verifiedRecords.length) {
    const sectionHeading = document.createElement('strong');
    sectionHeading.className = 'nearby-roads-section-heading';
    sectionHeading.textContent = 'Verified register records nearby';
    content.appendChild(sectionHeading);
    verifiedRecords.forEach(({ road, distanceMeters }) => {
      const card = document.createElement('article');
      card.className = 'nearby-road-card verified-nearby-road';
      const roadHeading = document.createElement('strong');
      roadHeading.textContent = road.name || 'Unnamed road record';
      card.appendChild(roadHeading);
      addPopupDetail(card, 'Record distance', `${Math.round(distanceMeters)} m; not auto-matched to an OSM road line`);
      addPopupDetail(card, 'Condition', road.condition);
      addPopupDetail(card, 'Contractor', road.contractor);
      addPopupDetail(card, 'Construction price', road.constructionCost === null || road.constructionCost === undefined
        ? null
        : formatCurrency(road.constructionCost));
      addPopupDetail(card, 'Guarantee / maintenance period', road.validityMonths
        ? `${road.validityMonths} months`
        : null);
      addPopupDetail(card, 'Built / repaired dates', road.lastInspection
        ? `Last inspected ${road.lastInspection}; construction/repair date not on file`
        : null);
      addPopupDetail(card, 'Evidence', road.sourceReference);
      content.appendChild(card);
    });
  } else {
    const noRecord = document.createElement('p');
    noRecord.className = 'nearby-roads-no-record';
    noRecord.textContent = 'No verified contractor, construction price, guarantee period, or build/repair record is on file within 1 km.';
    content.appendChild(noRecord);
  }

  const nearbyReports = getNearbyConditionReports(coordinates);
  if (nearbyReports.length) {
    const sectionHeading = document.createElement('strong');
    sectionHeading.className = 'nearby-roads-section-heading';
    sectionHeading.textContent = 'Community reports within 1 km';
    content.appendChild(sectionHeading);
    nearbyReports.forEach(({ feature, distanceMeters }) => {
      const report = feature.properties;
      const item = document.createElement('p');
      item.className = 'nearby-road-detail';
      item.textContent = `${report.roadName || `${report.roadClass.replaceAll('_', ' ')} road`} · ${report.ratingLabel} (${report.averageRating}/5) · ${report.reportCount} report${Number(report.reportCount) === 1 ? '' : 's'} · ${Math.round(distanceMeters)} m · community-reported`;
      content.appendChild(item);
    });
  }

  const sourceNote = document.createElement('small');
  sourceNote.className = 'nearby-roads-source-note';
  sourceNote.textContent = 'OpenStreetMap road tags are not inspections. Contract fields are not inferred. No location history is saved by this popup.';
  content.appendChild(sourceNote);

  if (nearbyRoadPopup) nearbyRoadPopup.remove();
  nearbyRoadPopup = new maplibregl.Popup({
    maxWidth: '390px',
    closeOnMove: false,
    anchor: mobileLayoutQuery.matches ? 'bottom' : undefined,
  })
    .setLngLat(coordinates)
    .setDOMContent(content)
    .addTo(map);
};

const scheduleNearbyRoadPopup = (coordinates) => {
  window.clearTimeout(nearbyRoadPopupTimer);
  if (!userLocationMarker || !mapReady) return;
  const render = () => renderNearbyRoadPopup(coordinates);
  const renderAfterIdle = () => {
    window.clearTimeout(nearbyRoadPopupTimer);
    map.off('idle', renderAfterIdle);
    render();
  };
  map.once('idle', renderAfterIdle);
  nearbyRoadPopupTimer = window.setTimeout(renderAfterIdle, 1800);
};

const setPmgsyStatus = (message, error = false) => {
  pmgsyStatusEl.textContent = message;
  pmgsyStatusEl.classList.toggle('error', error);
};

const resetPmgsySelect = (select, placeholder) => {
  select.replaceChildren(new Option(placeholder, ''));
  select.disabled = true;
};

const populatePmgsySelect = (select, placeholder, records) => {
  const options = [new Option(placeholder, ''), ...records.map((record) => new Option(record.name, record.id))];
  select.replaceChildren(...options);
  select.disabled = records.length === 0;
};

const loadPmgsyStates = async () => {
  if (pmgsyStatesLoaded) return;
  setPmgsyStatus('Loading official state list…');
  const response = await fetch('/api/pmgsy/states');
  const records = await response.json();
  if (!response.ok) throw new Error(records.message || 'Unable to load PMGSY states.');
  populatePmgsySelect(pmgsyStateEl, 'Choose a state', records);
  pmgsyStatesLoaded = true;
  setPmgsyStatus('Choose a state to browse available PMGSY road records.');
};

const loadPmgsyOptions = async (select, endpoint, parameter, value, placeholder) => {
  const response = await fetch(`/api/pmgsy/${endpoint}?${new URLSearchParams({ [parameter]: value })}`);
  const records = await response.json();
  if (!response.ok) throw new Error(records.message || `Unable to load PMGSY ${endpoint}.`);
  populatePmgsySelect(select, placeholder, records);
  return records.length;
};

const renderPmgsyDetails = (details) => {
  const entries = [
    ['Road', details.roadName],
    ['Package number', details.packageNo],
    ['Contractor', details.contractor],
    ['Road length', details.lengthKm === null ? null : `${details.lengthKm} km`],
    ['BT / CC length', details.btLengthKm === null && details.ccLengthKm === null
      ? null
      : `${details.btLengthKm ?? 'Not listed'} km / ${details.ccLengthKm ?? 'Not listed'} km`],
    ['Maintenance period', details.maintenanceStartDate || details.maintenanceEndDate
      ? `${details.maintenanceStartDate || 'Start date not listed'} – ${details.maintenanceEndDate || 'End date not listed'}`
      : null],
    ['eMARG maintenance expenditure', details.maintenanceExpenditureRupees === null
      ? null
      : formatCurrency(details.maintenanceExpenditureRupees)],
    ['eMARG inspection mark', details.inspectionMark],
    ['Construction award cost', 'Not provided by this eMARG record'],
  ];
  const grid = document.createElement('dl');
  grid.className = 'pmgsy-detail-grid';
  entries.forEach(([label, value]) => {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value || 'Not listed';
    item.append(term, description);
    grid.appendChild(item);
  });
  const source = document.createElement('a');
  source.href = details.sourceUrl;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.textContent = 'Open official eMARG portal';
  const metadata = document.createElement('p');
  metadata.className = 'pmgsy-source-note';
  metadata.textContent = `${details.source} · Retrieved ${new Date(details.retrievedAt).toLocaleString()}. Inspection mark is shown as published; it is not converted into the app’s community condition scale.`;
  const clearance = document.createElement('a');
  clearance.href = 'https://nrida.dord.gov.in/sites/default/files/clearance_letter/CLEARANCE%20-%20KARNATAKA%20%28PMGSY%20-%20III%20%26%20BATCH%20%E2%80%93I%2C%202022-23%29.pdf';
  clearance.target = '_blank';
  clearance.rel = 'noopener noreferrer';
  clearance.textContent = 'Karnataka PMGSY-III Batch I clearance (2022–23)';
  pmgsyDetailsEl.replaceChildren(grid, source, clearance, metadata);
  pmgsyDetailsEl.classList.remove('hidden');
};

const zoomToPmgsyRoad = async (details) => {
  const query = new URLSearchParams({
    road: details.roadName || pmgsyRoadEl.selectedOptions[0].textContent,
    block: pmgsyBlockEl.selectedOptions[0].textContent,
    district: pmgsyDistrictEl.selectedOptions[0].textContent,
    state: pmgsyStateEl.selectedOptions[0].textContent,
  });
  const response = await fetch(`/api/pmgsy/road-location?${query}`);
  const location = await response.json();
  if (!response.ok) throw new Error(location.message || 'Unable to locate this PMGSY road on the map.');
  if (!location.bounds || !location.center
    || !location.bounds.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
    setPmgsyStatus(location.message, true);
    return;
  }

  const popupContent = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = details.roadName || 'PMGSY road';
  popupContent.appendChild(title);
  [
    `Package: ${details.packageNo || 'Not listed'}`,
    `Contractor: ${details.contractor || 'Not listed'}`,
    location.message,
    `Map candidate source: ${location.source}.`,
  ].forEach((text) => {
    const line = document.createElement('div');
    line.textContent = text;
    popupContent.appendChild(line);
  });
  const googleMapsLink = document.createElement('a');
  const googleMapsQuery = [
    details.roadName || pmgsyRoadEl.selectedOptions[0].textContent,
    pmgsyBlockEl.selectedOptions[0].textContent,
    pmgsyDistrictEl.selectedOptions[0].textContent,
    pmgsyStateEl.selectedOptions[0].textContent,
    'India',
  ].join(', ');
  googleMapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleMapsQuery)}`;
  googleMapsLink.target = '_blank';
  googleMapsLink.rel = 'noopener noreferrer';
  googleMapsLink.textContent = 'Search this road in Google Maps';
  popupContent.appendChild(googleMapsLink);
  const [westSouth, eastNorth] = location.bounds;
  const areaMaxZoom = location.matchType === 'block-area' ? 12 : 10;
  map.fitBounds([westSouth, eastNorth], {
    padding: { top: 70, right: 70, bottom: 85, left: 70 },
    maxZoom: location.matchType === 'road-name-candidate' ? 15 : areaMaxZoom,
    duration: 1200,
  });
  map.once('moveend', () => {
    new maplibregl.Popup({ maxWidth: '320px' })
      .setLngLat(location.center)
      .setDOMContent(popupContent)
      .addTo(map);
  });
  closePmgsyDesk();
  pmgsyToggleBtn.classList.add('active');
  pmgsyToggleBtn.textContent = 'PMGSY road records · map';
  showMapStatus(location.message, 'success');
};

pmgsyStateEl.addEventListener('change', async () => {
  resetPmgsySelect(pmgsyDistrictEl, 'Choose a district');
  resetPmgsySelect(pmgsyBlockEl, 'Choose a block');
  resetPmgsySelect(pmgsyRoadEl, 'Choose a road');
  pmgsyDetailsEl.classList.add('hidden');
  if (!pmgsyStateEl.value) return;
  pmgsyStateEl.disabled = true;
  try {
    setPmgsyStatus('Loading districts…');
    const count = await loadPmgsyOptions(pmgsyDistrictEl, 'districts', 'state', pmgsyStateEl.value, 'Choose a district');
    setPmgsyStatus(count ? 'Choose a district.' : 'No districts are listed for this state.');
  } catch (error) {
    setPmgsyStatus(error.message, true);
  } finally {
    pmgsyStateEl.disabled = false;
  }
});

pmgsyDistrictEl.addEventListener('change', async () => {
  resetPmgsySelect(pmgsyBlockEl, 'Choose a block');
  resetPmgsySelect(pmgsyRoadEl, 'Choose a road');
  pmgsyDetailsEl.classList.add('hidden');
  if (!pmgsyDistrictEl.value) return;
  pmgsyDistrictEl.disabled = true;
  try {
    setPmgsyStatus('Loading blocks…');
    const count = await loadPmgsyOptions(pmgsyBlockEl, 'blocks', 'district', pmgsyDistrictEl.value, 'Choose a block');
    setPmgsyStatus(count ? 'Choose a block.' : 'No blocks are listed for this district.');
  } catch (error) {
    setPmgsyStatus(error.message, true);
  } finally {
    pmgsyDistrictEl.disabled = false;
  }
});

pmgsyBlockEl.addEventListener('change', async () => {
  resetPmgsySelect(pmgsyRoadEl, 'Choose a road');
  pmgsyDetailsEl.classList.add('hidden');
  if (!pmgsyBlockEl.value) return;
  pmgsyBlockEl.disabled = true;
  try {
    setPmgsyStatus('Loading road list…');
    const query = new URLSearchParams({
      district: pmgsyDistrictEl.value,
      block: pmgsyBlockEl.value,
    });
    const response = await fetch(`/api/pmgsy/roads?${query}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load PMGSY roads.');
    populatePmgsySelect(pmgsyRoadEl, 'Choose a road', result.roads);
    setPmgsyStatus(result.truncated
      ? 'Showing the first 1,000 roads returned for this block.'
      : `${result.roads.length} PMGSY roads listed. Choose one to view its details.`);
  } catch (error) {
    setPmgsyStatus(error.message, true);
  } finally {
    pmgsyBlockEl.disabled = false;
  }
});

pmgsyRoadEl.addEventListener('change', async () => {
  pmgsyDetailsEl.classList.add('hidden');
  if (!pmgsyRoadEl.value) return;
  pmgsyRoadEl.disabled = true;
  try {
    setPmgsyStatus('Loading road details from eMARG…');
    const response = await fetch(`/api/pmgsy/road/${encodeURIComponent(pmgsyRoadEl.value)}`);
    const details = await response.json();
    if (!response.ok) throw new Error(details.message || 'Unable to load PMGSY road details.');
    renderPmgsyDetails(details);
    setPmgsyStatus('Official eMARG record loaded. Values reflect what the portal publishes for this road.');
    try {
      await zoomToPmgsyRoad(details);
    } catch (error) {
      console.error('PMGSY road map search failed:', error);
      setPmgsyStatus(`Road details loaded, but the map location search failed: ${error.message}`, true);
    }
  } catch (error) {
    setPmgsyStatus(error.message, true);
  } finally {
    pmgsyRoadEl.disabled = false;
  }
});

const updateCommunityRoadVisibility = () => {
  const localRoadLayers = new Set(localRoadLayerIds);
  communityRoadLayerIds.forEach((layerId) => {
    const visible = showCommunityRoads && (showLocalRoads || !localRoadLayers.has(layerId));
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  });
};

const refreshStorageStatus = async () => {
  try {
    const response = await fetch('/api/storage-status');
    const status = await response.json();
    if (!response.ok || !status.connected) {
      throw new Error(status.message || 'Storage is unavailable.');
    }
    storageStatusEl.textContent = status.provider === 'MongoDB' ? 'DB · MONGO' : 'DB · JSON';
    storageStatusEl.classList.toggle('storage-mongo', status.provider === 'MongoDB');
    storageStatusEl.title = `${status.provider} connected`;
  } catch (error) {
    storageStatusEl.textContent = 'DB · OFFLINE';
    storageStatusEl.classList.add('storage-error');
    storageStatusEl.title = error.message;
    console.error('Storage status failed to load:', error);
  }
};

const renderRoadDataSources = async () => {
  const response = await fetch('/api/road-data-sources');
  if (!response.ok) {
    throw new Error('Unable to load road data source directory.');
  }

  const sources = await response.json();
  sourceListEl.replaceChildren();
  sources.forEach((source) => {
    const card = document.createElement('article');
    card.className = 'source-card';

    const heading = document.createElement('h4');
    heading.textContent = source.name;
    card.appendChild(heading);

    const organization = document.createElement('p');
    organization.className = 'source-organization';
    organization.textContent = source.organization;
    card.appendChild(organization);

    const role = document.createElement('p');
    role.textContent = source.role;
    card.appendChild(role);

    const status = document.createElement('p');
    status.className = 'source-status';
    status.textContent = source.dataStatus;
    card.appendChild(status);

    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open source ↗';
    card.appendChild(link);
    sourceListEl.appendChild(card);
  });
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === '') return 'Not verified';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value || 0);
};

const getMarkerColor = (condition) => {
  if (condition === 'Critical' || condition === 'Severe') return '#dc2626';
  if (condition === 'Poor' || condition === 'Moderate') return '#f97316';
  if (condition === 'Fair') return '#facc15';
  if (condition === 'Good') return '#22c55e';
  if (condition === 'Excellent') return '#2563eb';
  return '#8a98a8';
};

const renderSummary = (summary) => {
  totalRoadsEl.textContent = summary.totalRoads;
  totalCostEl.textContent = formatCurrency(summary.totalCost);
  avgValidityEl.textContent = summary.avgValidity === null ? 'Not verified' : `${summary.avgValidity} mos`;
  severeRoadsEl.textContent = summary.severeRoads;
  totalRoadKmEl.textContent = `${summary.totalRoadKm} km`;
  avgCostPerKmEl.textContent = formatCurrency(summary.avgCostPerKm);
};

const renderContractors = (contractors) => {
  contractorListEl.innerHTML = '';

  if (!contractors.length) {
    contractorListEl.innerHTML = '<p class="empty-state">Contractor details appear when an award or work-order record is available.</p>';
    return;
  }

  contractors.slice(0, 5).forEach((contractor) => {
    const item = document.createElement('div');
    item.className = 'contractor-card';
    const heading = document.createElement('h4');
    heading.textContent = contractor.contractor;
    item.appendChild(heading);

    [
      `Jobs on record: ${contractor.jobs}`,
      `Rating: ${contractor.averageRating === null ? 'Not verified' : `${contractor.averageRating}/5`}`,
      `Contract value: ${formatCurrency(contractor.totalCost)}`,
      `Avg validity: ${contractor.avgValidity === null ? 'Not verified' : `${contractor.avgValidity} mos`}`,
      `Avg cost/km: ${formatCurrency(contractor.avgCostPerKm)}`,
    ].forEach((text) => {
      const detail = document.createElement('p');
      detail.textContent = text;
      item.appendChild(detail);
    });
    contractorListEl.appendChild(item);
  });
};

const getFilteredRoads = (roads) => {
  const selectedCondition = conditionFilterEl.value;
  const conditionFiltered = selectedCondition === 'All'
    ? roads
    : roads.filter((road) => road.condition === selectedCondition);
  const search = roadSearchEl.value.trim().toLocaleLowerCase();
  if (!search) return conditionFiltered;

  return conditionFiltered.filter((road) => [
    road.name,
    road.area,
    road.contractor,
    road.contractId,
    road.sourceReference,
    road.source,
    road.roadType,
  ].some((value) => String(value || '').toLocaleLowerCase().includes(search)));
};

const renderRoadTable = (roads) => {
  const filtered = getFilteredRoads(roads);

  roadTableBodyEl.innerHTML = '';
  tableCountEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`;

  if (!filtered.length) {
    roadTableBodyEl.innerHTML = '<tr><td colspan="10" class="empty-state">No verified road records match this view. Map tiles show geography, not contract or inspection facts.</td></tr>';
    return;
  }

  filtered.forEach((road) => {
    const row = document.createElement('tr');
    const cells = [
      road.name || 'Unnamed road',
      road.area || 'Not specified',
      road.condition || 'Unverified',
      road.contractor || 'Not verified',
      road.contractId || 'Not on file',
      road.sizeKm === null || road.sizeKm === undefined ? 'Not verified' : `${road.sizeKm} km`,
      formatCurrency(road.constructionCost),
      road.potholeCount === null || road.potholeCount === undefined ? 'Not inspected' : road.potholeCount,
      road.lastInspection || 'Not inspected',
      road.sourceReference || road.source || 'Not on file',
    ];

    cells.forEach((text, index) => {
      const cell = document.createElement('td');
      if (index === 2) {
        const badge = document.createElement('span');
        badge.className = `badge ${String(road.condition || 'unverified').toLowerCase()}`;
        badge.textContent = text;
        cell.appendChild(badge);
      } else {
        cell.textContent = text;
      }
      row.appendChild(cell);
    });
    roadTableBodyEl.appendChild(row);
  });
};

const renderRoads = (roads) => {
  const filtered = getFilteredRoads(roads);
  const features = filtered.map((road) => {
    const coordinates = Array.isArray(road.geometry) && road.geometry.length > 1
      ? road.geometry.map(([lat, lng]) => [Number(lng), Number(lat)])
      : road.lat !== null && road.lat !== undefined
        && road.lng !== null && road.lng !== undefined
        && Number.isFinite(Number(road.lat)) && Number.isFinite(Number(road.lng))
        ? [Number(road.lng), Number(road.lat)]
        : null;
    if (!coordinates) return null;

    return {
      type: 'Feature',
      properties: { roadId: String(road.id), condition: road.condition || 'Unverified' },
      geometry: Array.isArray(coordinates[0])
        ? { type: 'LineString', coordinates }
        : { type: 'Point', coordinates },
    };
  }).filter(Boolean);

  const roadSource = map.getSource('verified-road-data');
  if (roadSource) {
    roadSource.setData({ type: 'FeatureCollection', features });
  }

  if (!filtered.length) {
    const hasRoads = roads.length > 0;
    showMapStatus(
      hasRoads
        ? 'No road records match this search or condition filter.'
        : 'OSM roads are reference geometry. Colors show verified records, community hotspots, and short road sections linked by a report’s OSM way ID; unmatched roads remain unrated.',
      'success'
    );
    return;
  }

  clearMapStatus();

  if (!roadsFitted && mapReady && features.length) {
    const bounds = new maplibregl.LngLatBounds();
    features.forEach((feature) => {
      const coordinates = feature.geometry.type === 'LineString'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];
      coordinates.forEach((coordinate) => bounds.extend(coordinate));
    });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 50, maxZoom: 10, duration: 0 });
      roadsFitted = true;
    }
  }
};

const addVerifiedRoadLayers = () => {
  map.addSource('verified-road-data', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'verified-road-lines',
    type: 'line',
    source: 'verified-road-data',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': [
        'match', ['get', 'condition'],
        'Critical', '#ff5f6d',
        'Severe', '#ff5f6d',
        'Poor', '#ff8b45',
        'Moderate', '#ff8b45',
        'Fair', '#ffd166',
        'Good', '#49d17d',
        'Excellent', '#66b7ff',
        '#a5b0bd',
      ],
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 12, 5],
    },
  });
  map.addLayer({
    id: 'verified-road-points',
    type: 'circle',
    source: 'verified-road-data',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 7,
      'circle-color': [
        'match', ['get', 'condition'],
        'Critical', '#ff5f6d',
        'Severe', '#ff5f6d',
        'Poor', '#ff8b45',
        'Moderate', '#ff8b45',
        'Fair', '#ffd166',
        'Good', '#49d17d',
        'Excellent', '#66b7ff',
        '#a5b0bd',
      ],
      'circle-stroke-color': '#08131f',
      'circle-stroke-width': 1.5,
    },
  });

  ['verified-road-lines', 'verified-road-points'].forEach((layerId) => {
    map.on('click', layerId, (event) => {
      const road = allRoads.find((item) => String(item.id) === event.features?.[0]?.properties?.roadId);
      if (!road) return;

      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = road.name || 'Unnamed road';
      popup.appendChild(title);
      [
        road.area,
        `Type: ${road.roadType}`,
        `Condition: ${road.condition || 'Not verified'}`,
        `Contractor: ${road.contractor || 'Not verified'}`,
        `Contract value: ${formatCurrency(road.constructionCost)}`,
        `Potholes: ${road.potholeCount ?? 'Not inspected'}`,
        `Last inspected: ${road.lastInspection || 'Not inspected'}`,
        `Source: ${road.sourceReference || road.source || 'Not on file'}`,
      ].forEach((text) => {
        const detail = document.createElement('div');
        detail.textContent = text;
        popup.appendChild(detail);
      });

      new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setDOMContent(popup)
        .addTo(map);
    });
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  });
};

const refreshConditionReports = async () => {
  const response = await fetch('/api/condition-reports');
  if (!response.ok) {
    throw new Error('Unable to load community condition reports.');
  }
  const reports = await response.json();
  if (reports.type !== 'FeatureCollection' || !Array.isArray(reports.features)) {
    throw new Error('Community condition report data is invalid.');
  }

  conditionReportFeatures = reports;
  const source = map.getSource('condition-report-data');
  if (source) source.setData(reports);
  renderConditionRoadSegments();
};

const renderConditionRoadSegments = () => {
  const source = map.getSource('condition-road-data');
  if (!source) return;

  const setSegments = (features) => {
    const dataKey = JSON.stringify(features);
    if (dataKey === conditionRoadSegmentDataKey) return;
    conditionRoadSegmentDataKey = dataKey;
    source.setData({ type: 'FeatureCollection', features });
  };
  const reportsByWayId = new Map();
  conditionReportFeatures.features.forEach((report) => {
    const wayId = report.properties?.osmWayId;
    if (wayId === undefined || wayId === null || wayId === '') return;
    const reports = reportsByWayId.get(String(wayId)) || [];
    reports.push(report);
    reportsByWayId.set(String(wayId), reports);
  });
  const roadLayerIds = communityRoadLayerIds.filter((layerId) => {
    const layer = map.getLayer(layerId);
    return layer?.type === 'line'
      && !layerId.includes('casing')
      && map.getLayoutProperty(layerId, 'visibility') !== 'none';
  });
  if (!reportsByWayId.size || !roadLayerIds.length || !showCommunityRoads) {
    setSegments([]);
    return;
  }

  const features = [];
  const seenSegments = new Set();
  map.queryRenderedFeatures({ layers: roadLayerIds }).forEach((road) => {
    if (road.id === undefined || road.id === null) return;
    const linkedReports = reportsByWayId.get(String(road.id));
    if (!linkedReports) return;
    const geometryType = road.geometry?.type;
    const lines = geometryType === 'LineString'
      ? [road.geometry.coordinates]
      : geometryType === 'MultiLineString'
        ? road.geometry.coordinates
        : [];

    linkedReports.forEach((report) => {
      const origin = report.geometry?.coordinates;
      if (!Array.isArray(origin) || origin.length < 2) return;
      lines.forEach((line) => {
        const clipped = clipRoadLineAtReport(line, origin);
        if (!clipped) return;
        const key = `${report.id}:${road.id}:${JSON.stringify(clipped)}`;
        if (seenSegments.has(key)) return;
        seenSegments.add(key);
        features.push({
          type: 'Feature',
          id: key,
          properties: {
            reportId: String(report.id),
            ratingLabel: report.properties.ratingLabel,
          },
          geometry: { type: 'LineString', coordinates: clipped },
        });
      });
    });
  });
  setSegments(features);
};

const reportDate = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const showConditionReportSummary = (feature, location) => {
  const properties = feature.properties;
  const popupContent = document.createElement('div');
  popupContent.className = 'condition-report-summary';
  const heading = document.createElement('strong');
  heading.textContent = properties.roadName || (properties.roadClass === 'road'
    ? 'Road location'
    : `${properties.roadClass.replaceAll('_', ' ')} road`);
  popupContent.appendChild(heading);

  const summary = document.createElement('p');
  summary.textContent = `Community-reported · ${properties.averageRating}/5 (${properties.ratingLabel}) · ${properties.reportCount} ${Number(properties.reportCount) === 1 ? 'report' : 'reports'}`;
  popupContent.appendChild(summary);

  const counts = Array.isArray(properties.ratingCounts)
    ? properties.ratingCounts
    : JSON.parse(properties.ratingCounts || '[0,0,0,0,0]');
  const distribution = document.createElement('p');
  distribution.textContent = counts
    .map((count, index) => `${conditionRatingDescriptions[index + 1][0]}: ${count}`)
    .join(' · ');
  popupContent.appendChild(distribution);

  const lastReported = document.createElement('small');
  lastReported.textContent = `Latest report: ${reportDate(properties.lastReported)} · Not an official inspection`;
  popupContent.appendChild(lastReported);
  new maplibregl.Popup()
    .setLngLat(location)
    .setDOMContent(popupContent)
    .addTo(map);
};

const addConditionReportLayer = () => {
  map.addSource('condition-report-data', {
    type: 'geojson',
    data: conditionReportFeatures,
  });
  map.addSource('condition-road-data', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  [
    ['Best', '#49d17d'],
    ['Good', '#a3e635'],
    ['Bad', '#ffd166'],
    ['Worse', '#ff8b45'],
    ['Worst', '#ff5f6d'],
  ].forEach(([ratingLabel, color]) => {
    map.addLayer({
      id: `condition-report-heatmap-${ratingLabel.toLowerCase()}`,
      type: 'heatmap',
      source: 'condition-report-data',
      filter: ['==', ['get', 'ratingLabel'], ratingLabel],
      paint: {
        'heatmap-weight': [
          'interpolate', ['linear'], ['get', 'reportCount'],
          1, 1,
          5, 1.8,
          20, 2.8,
        ],
        'heatmap-intensity': [
          'interpolate', ['linear'], ['zoom'],
          2, 1.6,
          8, 2,
          14, 2.5,
        ],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0, 0, 0, 0)',
          0.005, `${color}2e`,
          0.03, `${color}59`,
          0.15, `${color}a6`,
          0.4, `${color}d6`,
          1, `${color}f5`,
        ],
        'heatmap-radius': [
          'interpolate', ['linear'], ['zoom'],
          2, 14,
          6, 24,
          10, 40,
          14, 65,
          17, 82,
          18, 92,
        ],
        'heatmap-opacity': 0.78,
      },
    });
  });
  map.addLayer({
    id: 'condition-road-segments',
    type: 'line',
    source: 'condition-road-data',
    paint: {
      'line-color': [
        'match', ['get', 'ratingLabel'],
        'Best', '#49d17d',
        'Good', '#a3e635',
        'Bad', '#ffd166',
        'Worse', '#ff8b45',
        'Worst', '#ff5f6d',
        '#cbd5e1',
      ],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6, 20, 9],
      'line-opacity': 0.96,
    },
  });
  map.addLayer({
    id: 'condition-report-points',
    type: 'circle',
    source: 'condition-report-data',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'reportCount'], 1, 6, 10, 11],
      'circle-color': [
        'match', ['get', 'ratingLabel'],
        'Best', '#49d17d',
        'Good', '#a3e635',
        'Bad', '#ffd166',
        'Worse', '#ff8b45',
        'Worst', '#ff5f6d',
        '#cbd5e1',
      ],
      'circle-stroke-color': '#08131f',
      'circle-stroke-width': 2,
      'circle-opacity': 0.94,
    },
  });
  map.on('mouseenter', 'condition-report-points', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'condition-report-points', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'condition-road-segments', (event) => {
    const reportId = event.features?.[0]?.properties?.reportId;
    const report = conditionReportFeatures.features.find((feature) => String(feature.id) === reportId);
    if (report) showConditionReportSummary(report, event.lngLat);
  });
  map.on('mouseenter', 'condition-road-segments', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'condition-road-segments', () => { map.getCanvas().style.cursor = ''; });
};

const addNhaiProjectLayer = () => {
  map.addSource('nhai-project-data', {
    type: 'geojson',
    data: nhaiProjectFeatures,
    attribution: 'Project data: <a href="https://datalakeg.nhai.gov.in/nhai/MISC/DataLakeGISDashboard">NHAI Data Lake GIS</a>',
  });
  map.addLayer({
    id: 'nhai-project-lines',
    type: 'line',
    source: 'nhai-project-data',
    layout: { visibility: 'none' },
    paint: {
      'line-color': '#ffb84d',
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 12, 6],
      'line-opacity': 0.95,
    },
  });
  map.on('click', 'nhai-project-lines', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const properties = feature.properties || {};
    const content = document.createElement('div');
    content.className = 'condition-report-summary nhai-project-popup';

    const heading = document.createElement('strong');
    heading.textContent = properties.project_na || properties.adv_project_name || 'NHAI road project';
    content.appendChild(heading);

    const details = [
      properties.adv_pkg_name ? `Package: ${properties.adv_pkg_name}` : null,
      properties.upc ? `Package code: ${properties.upc}` : null,
      properties.state ? `State: ${properties.state}` : null,
      properties.nh_new ? `National Highway: NH-${properties.nh_new}` : null,
      properties.length ? `Length: ${properties.length} km` : null,
      properties.mode ? `Delivery mode: ${properties.mode}` : null,
      properties.adv_total_capital_cost
        ? `NHAI portal capital cost: ₹${properties.adv_total_capital_cost} crore`
        : null,
      properties.current_st ? `Execution status: ${properties.current_st}` : null,
      properties.adv_cumphysical_progress_tilllastmonth
        ? `Physical progress: ${properties.adv_cumphysical_progress_tilllastmonth}%`
        : null,
      properties.adv_cumfinancial_progress_tilllastmonth
        ? `Financial progress: ${properties.adv_cumfinancial_progress_tilllastmonth}%`
        : null,
      properties.adv_appointed_date ? `Appointed date: ${properties.adv_appointed_date}` : null,
      properties.adv_scheduled_completion_date
        ? `Scheduled completion: ${properties.adv_scheduled_completion_date}`
        : null,
      properties.concession
        ? `Portal concession / project entity: ${properties.concession}`
        : null,
    ].filter(Boolean);

    details.forEach((text) => {
      const detail = document.createElement('p');
      detail.textContent = text;
      content.appendChild(detail);
    });
    const caveat = document.createElement('small');
    caveat.textContent = 'Live NHAI Data Lake GIS record. Portal capital cost is not necessarily final awarded or paid value; the concession field is not a verified contractor name.';
    content.appendChild(caveat);
    new maplibregl.Popup({ maxWidth: '360px' })
      .setLngLat(event.lngLat)
      .setDOMContent(content)
      .addTo(map);
  });
  map.on('mouseenter', 'nhai-project-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'nhai-project-lines', () => { map.getCanvas().style.cursor = ''; });
};

const refreshNhaiProjects = async (options = {}) => {
  const requestId = ++nhaiProjectRequestId;
  const bounds = map.getBounds().toArray();
  const west = Math.max(bounds[0][0], indiaBounds[0][0]);
  const south = Math.max(bounds[0][1], indiaBounds[0][1]);
  const east = Math.min(bounds[1][0], indiaBounds[1][0]);
  const north = Math.min(bounds[1][1], indiaBounds[1][1]);

  if (west >= east || south >= north) {
    nhaiProjectFeatures = { type: 'FeatureCollection', features: [] };
    map.getSource('nhai-project-data')?.setData(nhaiProjectFeatures);
    nhaiProjectBoundsKey = '';
    if (options.includeWhenHidden) nearbyNhaiDataStatus = 'error';
    nhaiProjectsToggleBtn.disabled = false;
    nhaiProjectsToggleBtn.textContent = `NHAI projects · ${showNhaiProjects ? 'on' : 'off'}`;
    if (showNhaiProjects) showMapStatus('The live NHAI project layer covers India only. Pan back to India to see projects.', 'error');
    return;
  }
  if (east - west > 12 || north - south > 12) {
    nhaiProjectFeatures = { type: 'FeatureCollection', features: [] };
    map.getSource('nhai-project-data')?.setData(nhaiProjectFeatures);
    nhaiProjectBoundsKey = '';
    if (options.includeWhenHidden) nearbyNhaiDataStatus = 'error';
    nhaiProjectsToggleBtn.disabled = false;
    nhaiProjectsToggleBtn.textContent = `NHAI projects · ${showNhaiProjects ? 'on' : 'off'}`;
    if (showNhaiProjects) showMapStatus('Zoom in to a state or district to load the live NHAI package data.', 'success');
    return;
  }

  const bbox = [west, south, east, north].map((value) => value.toFixed(4));
  const boundsKey = bbox.join(',');
  if (boundsKey === nhaiProjectBoundsKey && nhaiProjectFeatures.features.length) {
    if (options.includeWhenHidden) {
      nearbyNhaiDataStatus = 'loaded';
      const location = userLocationMarker?.getLngLat();
      if (location) renderNearbyRoadPopup([location.lng, location.lat]);
    }
    return;
  }
  nhaiProjectBoundsKey = boundsKey;
  nhaiProjectFeatures = { type: 'FeatureCollection', features: [] };
  map.getSource('nhai-project-data').setData(nhaiProjectFeatures);
  if (options.includeWhenHidden) nearbyNhaiDataStatus = 'loading';
  if (showNhaiProjects) {
    nhaiProjectsToggleBtn.disabled = true;
    nhaiProjectsToggleBtn.textContent = 'NHAI projects · loading';
  }

  try {
    const response = await fetch(`/api/nhai-projects?bbox=${encodeURIComponent(boundsKey)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load NHAI project data.');
    if (requestId !== nhaiProjectRequestId || (!showNhaiProjects && !options.includeWhenHidden)) return;

    nhaiProjectFeatures = data;
    if (options.includeWhenHidden) nearbyNhaiDataStatus = 'loaded';
    map.getSource('nhai-project-data').setData(data);
    if (showNhaiProjects && data.truncated) {
      showMapStatus(`Showing ${data.features.length} of ${data.matched} live NHAI packages in this view. Zoom in to narrow the results.`, 'success');
    } else if (showNhaiProjects) {
      showMapStatus(`${data.features.length} live NHAI project packages loaded for this view. Click a line for cost, progress, status and contract details.`, 'success');
    }
    if (options.includeWhenHidden && !showNhaiProjects && userLocationMarker) {
      const location = userLocationMarker.getLngLat();
      renderNearbyRoadPopup([location.lng, location.lat]);
    }
  } catch (error) {
    if (requestId === nhaiProjectRequestId && showNhaiProjects) {
      nhaiProjectBoundsKey = '';
      console.error('Live NHAI project data failed to load:', error);
      showMapStatus(`Live NHAI project data unavailable: ${error.message}`, 'error');
    }
    if (requestId === nhaiProjectRequestId && options.includeWhenHidden) {
      nearbyNhaiDataStatus = 'error';
      console.error('Nearby NHAI project data failed to load:', error);
      const location = userLocationMarker?.getLngLat();
      if (location) renderNearbyRoadPopup([location.lng, location.lat]);
    }
  } finally {
    if (requestId === nhaiProjectRequestId) {
      nhaiProjectsToggleBtn.disabled = false;
      nhaiProjectsToggleBtn.textContent = `NHAI projects · ${showNhaiProjects ? 'on' : 'off'}`;
    }
  }
};

const showConditionReportForm = (feature, location) => {
  const properties = feature.properties || {};
  const sourceRoadClass = typeof properties.class === 'string' ? properties.class.toLowerCase() : '';
  const roadClass = sourceRoadClass.replace(/_link$/, '');
  const supportedClasses = new Set([
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor',
    'residential', 'unclassified', 'service', 'track', 'path', 'pedestrian',
    'living_street', 'footway', 'cycleway', 'bridleway', 'steps', 'road',
    'street', 'construction',
  ]);
  const reportRoadClass = supportedClasses.has(roadClass) ? roadClass : 'road';
  const roadName = [properties.name, properties.ref].filter(Boolean).join(' · ').slice(0, 120);
  const osmWayId = /^\d{1,30}$/.test(String(feature.id)) ? String(feature.id) : '';
  const popupContent = document.createElement('form');
  popupContent.className = 'condition-report-form';

  const heading = document.createElement('strong');
  heading.textContent = roadName || (reportRoadClass === 'road'
    ? 'Road location'
    : `${reportRoadClass.replaceAll('_', ' ')} road`);
  popupContent.appendChild(heading);

  const sourceLabel = document.createElement('small');
  sourceLabel.textContent = 'Community location report · not an official inspection';
  popupContent.appendChild(sourceLabel);

  const ratingLabel = document.createElement('label');
  ratingLabel.textContent = 'How is the road right here?';
  const ratingSelect = document.createElement('select');
  ratingSelect.name = 'rating';
  ratingSelect.required = true;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a rating';
  placeholder.disabled = true;
  placeholder.selected = true;
  ratingSelect.appendChild(placeholder);
  Object.entries(conditionRatingDescriptions).forEach(([rating, [name]]) => {
    const option = document.createElement('option');
    option.value = rating;
    option.textContent = name;
    ratingSelect.appendChild(option);
  });
  ratingLabel.appendChild(ratingSelect);
  popupContent.appendChild(ratingLabel);

  const description = document.createElement('small');
  description.className = 'condition-rating-description';
  description.textContent = 'Choose the closest description.';
  popupContent.appendChild(description);
  ratingSelect.addEventListener('change', () => {
    description.textContent = conditionRatingDescriptions[ratingSelect.value][1];
  });

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.textContent = 'Publish community report';
  popupContent.appendChild(submitButton);

  const popup = new maplibregl.Popup({ maxWidth: '310px' })
    .setLngLat(location)
    .setDOMContent(popupContent)
    .addTo(map);
  popupContent.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ratingSelect.value) return;
    submitButton.disabled = true;
    submitButton.textContent = 'Publishing…';
    try {
      const response = await fetch('/api/condition-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: Number(ratingSelect.value),
          lat: location.lat,
          lng: location.lng,
          roadName,
          roadClass: reportRoadClass,
          osmWayId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to publish report.');

      popup.remove();
      showMapStatus(`${result.ratingLabel} community report published. It is not an official inspection.`, 'success');
      try {
        await refreshConditionReports();
      } catch (error) {
        console.error('Community reports failed to refresh:', error);
        showMapStatus(`Report published, but map markers could not refresh: ${error.message}`, 'error');
      }
    } catch (error) {
      showMapStatus(error.message, 'error');
      submitButton.disabled = false;
      submitButton.textContent = 'Publish community report';
    }
  });
};

const initializeHighwayLayer = async () => {
  try {
    const archive = new pmtiles.PMTiles(highwayArchiveUrl);
    const [header, metadata] = await Promise.all([archive.getHeader(), archive.getMetadata()]);
    const sourceLayer = metadata.vector_layers?.[0]?.id;
    if (!sourceLayer) throw new Error('National Highways vector layer metadata is missing.');

    map.addSource('national-highways', {
      type: 'vector',
      url: `pmtiles://${highwayArchiveUrl}`,
      minzoom: header.minZoom,
      maxzoom: header.maxZoom,
    });
    map.addLayer({
      id: 'national-highways-lines',
      type: 'line',
      source: 'national-highways',
      'source-layer': sourceLayer,
      layout: { visibility: showHighways ? 'visible' : 'none' },
      paint: {
        'line-color': '#6f8995',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 2, 12, 3.2],
        'line-opacity': 0.72,
      },
    }, 'verified-road-lines');
    map.on('click', 'national-highways-lines', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = feature.properties.road_name || feature.properties.project_na || 'National Highway';
      popup.appendChild(title);
      [
        feature.properties.state_ut ? `State / UT: ${feature.properties.state_ut}` : null,
        feature.properties.road_type ? `Road type: ${feature.properties.road_type}` : null,
        'Source: GatiShakti geometry, 2024 snapshot',
        'Contractor, award value, potholes, and current condition are not provided by this layer.',
      ].filter(Boolean).forEach((text) => {
        const detail = document.createElement('div');
        detail.textContent = text;
        popup.appendChild(detail);
      });
      new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(popup).addTo(map);
    });
    map.on('mouseenter', 'national-highways-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'national-highways-lines', () => { map.getCanvas().style.cursor = ''; });
  } catch (error) {
    console.error('National Highways layer failed to load:', error);
    showMapStatus(`National Highways layer could not be loaded: ${error.message}`, 'error');
    highwaysToggleBtn.disabled = true;
  }
};

const initializeStateBoundaries = async () => {
  try {
    const archive = new pmtiles.PMTiles(stateBoundariesArchiveUrl);
    const [header, metadata] = await Promise.all([archive.getHeader(), archive.getMetadata()]);
    const sourceLayer = metadata.vector_layers?.[0]?.id;
    if (!sourceLayer) throw new Error('LGD state boundary vector layer metadata is missing.');

    map.addSource('lgd-state-boundaries', {
      type: 'vector',
      url: `pmtiles://${stateBoundariesArchiveUrl}`,
      minzoom: header.minZoom,
      maxzoom: header.maxZoom,
    });
    map.addLayer({
      id: 'lgd-state-boundary-lines',
      type: 'line',
      source: 'lgd-state-boundaries',
      'source-layer': sourceLayer,
      paint: {
        'line-color': '#f0ead4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 7, 1.3, 10, 1.8],
        'line-opacity': 0.78,
      },
    }, 'verified-road-lines');
    map.on('click', 'lgd-state-boundary-lines', (event) => {
      const stateName = event.features?.[0]?.properties?.STNAME;
      if (!stateName) return;
      new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setText(`${stateName} · LGD 2024 reference boundary`)
        .addTo(map);
    });
    map.on('mouseenter', 'lgd-state-boundary-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'lgd-state-boundary-lines', () => { map.getCanvas().style.cursor = ''; });
  } catch (error) {
    console.error('LGD state boundary layer failed to load:', error);
    showMapStatus(`India boundary reference could not be loaded: ${error.message}`, 'error');
  }
};

map.on('error', (event) => {
  if (event.error) console.error('Map rendering error:', event.error);
});

map.on('load', () => {
  mapReady = true;
  communityRoadLayerIds = map.getStyle().layers
    .filter((layer) => layer['source-layer'] === 'transportation' && !/rail|transit/i.test(layer.id))
    .map((layer) => layer.id);
  localRoadLayerIds = communityRoadLayerIds.filter((layerId) => /(?:^|_)(?:minor|service_track|path_pedestrian|street)(?:_|$)/i.test(layerId));
  if (!communityRoadLayerIds.length) {
    showMapStatus('Community road data is unavailable in the current map style.', 'error');
  } else {
    communityRoadLayerIds.forEach((layerId) => {
      const layer = map.getLayer(layerId);
      if (layer.type === 'line' && !layerId.includes('casing')) {
        const isLocalRoad = localRoadLayerIds.includes(layerId);
        map.setPaintProperty(layerId, 'line-color', isLocalRoad ? '#91aeb5' : '#6f909b');
        map.setPaintProperty(layerId, 'line-opacity', 0.9);
      } else if (layer.type === 'line' && layerId.includes('casing')) {
        map.setPaintProperty(layerId, 'line-color', '#617780');
        map.setPaintProperty(layerId, 'line-opacity', 0.78);
      }
    });
    updateCommunityRoadVisibility();
    localRoadsToggleBtn.disabled = !localRoadLayerIds.length;
    if (!localRoadLayerIds.length) {
      showMapStatus('Local and village road classes are unavailable in the current map style.', 'error');
    }
  }
  addVerifiedRoadLayers();
  addConditionReportLayer();
  addNhaiProjectLayer();
  renderRoads(allRoads);
  map.on('click', (event) => {
    if (showNhaiProjects && map.queryRenderedFeatures(event.point, { layers: ['nhai-project-lines'] }).length) return;
    if (showConditionReports
      && map.queryRenderedFeatures(event.point, { layers: ['condition-road-segments'] }).length) return;
    const nearbyReport = showConditionReports && conditionReportFeatures.features.find((feature) => {
      const point = map.project(feature.geometry.coordinates);
      return Math.hypot(point.x - event.point.x, point.y - event.point.y) <= 20;
    });
    if (nearbyReport) {
      showConditionReportSummary(nearbyReport, event.lngLat);
      return;
    }
    const roadFeature = map.queryRenderedFeatures(event.point, { layers: communityRoadLayerIds })
      .filter((feature) => feature.sourceLayer === 'transportation'
        && ['LineString', 'MultiLineString'].includes(feature.geometry.type)
        && feature.id !== undefined)
      .sort((left, right) => Number(left.layer.id.includes('casing')) - Number(right.layer.id.includes('casing')))[0];
    showConditionReportForm(roadFeature || { properties: { class: 'road' } }, event.lngLat);
  });
  refreshConditionReports().catch((error) => {
    console.error('Community reports failed to load:', error);
    showMapStatus(`Community reports could not be loaded: ${error.message}`, 'error');
  });
  window.setInterval(() => {
    refreshConditionReports().catch((error) => console.error('Community reports refresh failed:', error));
  }, 60_000);
  map.on('moveend', () => {
    renderConditionRoadSegments();
    if (userLocationMarker) {
      const location = userLocationMarker.getLngLat();
      scheduleNearbyRoadPopup([location.lng, location.lat]);
    }
    if (!showNhaiProjects) return;
    window.clearTimeout(nhaiProjectMoveTimer);
    nhaiProjectMoveTimer = window.setTimeout(refreshNhaiProjects, 500);
  });
  map.on('idle', renderConditionRoadSegments);
  initializeStateBoundaries();
  initializeHighwayLayer();
});

const refreshDashboard = async () => {
  try {
const [summaryResponse, roadsResponse, contractorsResponse] = await Promise.all([
  fetch('/api/summary'),
  fetch('/api/roads'),
  fetch('/api/contractors'),
]);

if (!summaryResponse.ok || !roadsResponse.ok || !contractorsResponse.ok) {
  throw new Error('One or more road data endpoints failed to respond.');
    }

    const summary = await summaryResponse.json();
    const roads = await roadsResponse.json();
    const contractors = await contractorsResponse.json();

    if (!Array.isArray(roads)) {
      throw new Error('Road dataset is invalid.');
    }

    allRoads = roads;
    renderSummary(summary);
    renderContractors(contractors);
    renderRoadTable(roads);
    renderRoads(roads);
    if (roads.length) clearMapStatus();
  } catch (error) {
    console.error('Road data failed to load:', error);
    showMapStatus(`Road data failed to load: ${error.message}`, 'error');
    allRoads = [];
    renderSummary({
      totalRoads: 0,
      totalCost: 0,
      totalRoadKm: 0,
      avgValidity: 0,
      avgCostPerKm: 0,
      severeRoads: 0,
    });
    renderContractors([]);
    renderRoadTable([]);
    renderRoads([]);
  }
};

const applyRoadFilters = () => {
  renderRoadTable(allRoads);
  renderRoads(allRoads);
};

conditionFilterEl.addEventListener('change', applyRoadFilters);
roadSearchEl.addEventListener('input', applyRoadFilters);
zoomToIndiaBtn.addEventListener('click', () => {
  map.fitBounds(indiaBounds, { padding: 26 });
});

zoomToKarnatakaBtn.addEventListener('click', () => {
  map.fitBounds(karnatakaViewBounds, { padding: 26 });
});

locateMeBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showMapStatus('Your browser does not support location access.', 'error');
    return;
  }

  locateMeBtn.disabled = true;
  locateMeBtn.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition((position) => {
    const { latitude, longitude } = position.coords;
    if (userLocationMarker) userLocationMarker.remove();
    const markerElement = document.createElement('div');
    markerElement.className = 'user-location-marker';
    markerElement.setAttribute('aria-label', 'Your current location');
    userLocationMarker = new maplibregl.Marker({ element: markerElement })
      .setLngLat([longitude, latitude])
      .addTo(map);
    const mapSize = Math.min(map.getContainer().clientWidth, map.getContainer().clientHeight);
    const desiredMetersPerPixel = (nearbyRoadSearchRadiusMeters * 2) / Math.max(1, mapSize * 0.75);
    const metersPerPixelAtZoomZero = 40_075_016.686 * Math.cos(latitude * Math.PI / 180) / 512;
    const nearbyZoom = Math.max(14, Math.min(16, Math.log2(metersPerPixelAtZoomZero / desiredMetersPerPixel)));
    map.flyTo({
      center: [longitude, latitude],
      zoom: nearbyZoom,
      duration: 1000,
      padding: mobileLayoutQuery.matches
        ? { top: Math.round(map.getContainer().clientHeight * 0.34), right: 0, bottom: 0, left: 0 }
        : 0,
    });
    if (!showNhaiProjects) {
      nearbyNhaiDataStatus = 'loading';
      scheduleNearbyRoadPopup([longitude, latitude]);
      map.once('moveend', () => refreshNhaiProjects({ includeWhenHidden: true }));
    }
    showMapStatus('Map centered. Nearby mapped roads and any linked local records are shown in the location popup. Your coordinates are not saved.', 'success');
    locateMeBtn.disabled = false;
    locateMeBtn.textContent = '⌖ My location';
  }, (error) => {
    const message = error.code === error.PERMISSION_DENIED
      ? 'Location permission was denied. Allow location access in your browser to use this feature.'
      : error.code === error.POSITION_UNAVAILABLE
        ? 'Your current location is unavailable. Check your device location settings and try again.'
        : 'Location request timed out. Please try again.';
    showMapStatus(message, 'error');
    locateMeBtn.disabled = false;
    locateMeBtn.textContent = '⌖ My location';
  }, {
    enableHighAccuracy: true,
    maximumAge: 30_000,
    timeout: 15_000,
  });
});

highwaysToggleBtn.addEventListener('click', () => {
  if (!map.getLayer('national-highways-lines')) return;
  showHighways = !showHighways;
  map.setLayoutProperty('national-highways-lines', 'visibility', showHighways ? 'visible' : 'none');
  highwaysToggleBtn.setAttribute('aria-pressed', String(showHighways));
  highwaysToggleBtn.textContent = `NH layer · ${showHighways ? 'on' : 'off'}`;
  highwaysToggleBtn.classList.toggle('active', showHighways);
});

const communityRoadsToggleBtn = document.getElementById('toggleCommunityRoads');
communityRoadsToggleBtn.addEventListener('click', () => {
  if (!communityRoadLayerIds.length) return;
  showCommunityRoads = !showCommunityRoads;
  updateCommunityRoadVisibility();
  renderConditionRoadSegments();
  communityRoadsToggleBtn.setAttribute('aria-pressed', String(showCommunityRoads));
  communityRoadsToggleBtn.textContent = `OSM roads · ${showCommunityRoads ? 'on' : 'off'}`;
  communityRoadsToggleBtn.classList.toggle('active', showCommunityRoads);
});

localRoadsToggleBtn.addEventListener('click', () => {
  if (!localRoadLayerIds.length) return;
  showLocalRoads = !showLocalRoads;
  updateCommunityRoadVisibility();
  renderConditionRoadSegments();
  localRoadsToggleBtn.setAttribute('aria-pressed', String(showLocalRoads));
  localRoadsToggleBtn.textContent = `Local + village roads · ${showLocalRoads ? 'on' : 'off'}`;
  localRoadsToggleBtn.classList.toggle('active', showLocalRoads);
});

nhaiProjectsToggleBtn.addEventListener('click', () => {
  if (!map.getLayer('nhai-project-lines')) return;
  showNhaiProjects = !showNhaiProjects;
  map.setLayoutProperty('nhai-project-lines', 'visibility', showNhaiProjects ? 'visible' : 'none');
  nhaiProjectsToggleBtn.setAttribute('aria-pressed', String(showNhaiProjects));
  nhaiProjectsToggleBtn.classList.toggle('active', showNhaiProjects);
  if (showNhaiProjects) {
    nhaiProjectsToggleBtn.textContent = 'NHAI projects · on';
    refreshNhaiProjects();
  } else {
    nhaiProjectRequestId += 1;
    nhaiProjectsToggleBtn.disabled = false;
    nhaiProjectsToggleBtn.textContent = 'NHAI projects · off';
  }
});

conditionReportsToggleBtn.addEventListener('click', () => {
  if (!map.getLayer('condition-report-points')) return;
  showConditionReports = !showConditionReports;
  [
    ...['best', 'good', 'bad', 'worse', 'worst'].map((rating) => `condition-report-heatmap-${rating}`),
    'condition-road-segments',
    'condition-report-points',
  ].forEach((layerId) => {
    map.setLayoutProperty(layerId, 'visibility', showConditionReports ? 'visible' : 'none');
  });
  conditionReportsToggleBtn.setAttribute('aria-pressed', String(showConditionReports));
  conditionReportsToggleBtn.textContent = `Reports heatmap · ${showConditionReports ? 'on' : 'off'}`;
  conditionReportsToggleBtn.classList.toggle('active', showConditionReports);
});

const toggleSidebar = () => {
  const isClosed = document.body.classList.toggle('sidebar-closed');
  sidebarToggleButtons.forEach((button) => {
    button.setAttribute('aria-expanded', String(!isClosed));
  });
  map.resize();
};
sidebarToggleButtons.forEach((button) => button.addEventListener('click', toggleSidebar));

registerToggleBtn.addEventListener('click', () => {
  sourceDeskEl.classList.remove('source-open');
  sourceToggleBtn.setAttribute('aria-expanded', 'false');
  closePmgsyDesk();
  const isOpen = dashboardGridEl.classList.toggle('register-open');
  registerToggleBtn.setAttribute('aria-expanded', String(isOpen));
  map.resize();
});

const closeSourceDesk = () => {
  sourceDeskEl.classList.remove('source-open');
  sourceToggleBtn.setAttribute('aria-expanded', 'false');
};

const closePmgsyDesk = () => {
  pmgsyDeskEl.classList.remove('source-open');
  pmgsyToggleBtn.setAttribute('aria-expanded', 'false');
};

pmgsyToggleBtn.addEventListener('click', async () => {
  sourceDeskEl.classList.remove('source-open');
  sourceToggleBtn.setAttribute('aria-expanded', 'false');
  dashboardGridEl.classList.remove('register-open');
  registerToggleBtn.setAttribute('aria-expanded', 'false');
  const isOpen = pmgsyDeskEl.classList.toggle('source-open');
  pmgsyToggleBtn.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) {
    try {
      await loadPmgsyStates();
    } catch (error) {
      console.error('PMGSY state list failed to load:', error);
      setPmgsyStatus(error.message, true);
    }
  }
});

closePmgsyDeskBtn.addEventListener('click', closePmgsyDesk);

sourceToggleBtn.addEventListener('click', async () => {
  closePmgsyDesk();
  dashboardGridEl.classList.remove('register-open');
  registerToggleBtn.setAttribute('aria-expanded', 'false');
  const isOpen = sourceDeskEl.classList.toggle('source-open');
  sourceToggleBtn.setAttribute('aria-expanded', String(isOpen));
  if (isOpen && !sourceListEl.childElementCount) {
    try {
      await renderRoadDataSources();
    } catch (error) {
      console.error('Road data source directory failed to load:', error);
      sourceListEl.textContent = error.message;
    }
  }
});

closeSourcesBtn.addEventListener('click', closeSourceDesk);

const refreshAdminStatus = async () => {
  try {
    const response = await fetch('/api/admin/me');
    if (!response.ok) {
      throw new Error('Unable to check admin session.');
    }

    const data = await response.json();
    adminLoginForm.classList.toggle('authenticated', data.authenticated);
    logoutBtn.classList.toggle('hidden', !data.authenticated);
    form.classList.toggle('hidden', !data.authenticated);
    exportExcelBtn.disabled = !data.authenticated;
    exportPdfBtn.disabled = !data.authenticated;
  } catch (error) {
    console.error('Admin status failed to load:', error);
    showMapStatus(`Admin status failed to load: ${error.message}`, 'error');
  }
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  ['sizeKm', 'validityMonths', 'constructionCost', 'potholeCount', 'lat', 'lng'].forEach((field) => {
    if (payload[field] === '') delete payload[field];
  });

  const response = await fetch('/api/roads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: 'Unable to save the road report.' }));
    window.alert(data.message || 'Unable to save the road report.');
    return;
  }

  form.reset();
  await refreshDashboard();
});

adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(adminLoginForm);
  const payload = Object.fromEntries(formData.entries());

  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({ message: 'Login failed.' }));
  if (!response.ok) {
    window.alert(data.message || 'Login failed.');
    return;
  }

  adminLoginForm.reset();
  await refreshAdminStatus();
  window.alert(`Welcome ${data.username}.`);
});

logoutBtn.addEventListener('click', async () => {
  const response = await fetch('/api/admin/logout', { method: 'POST' });
  if (!response.ok) {
    showMapStatus('Unable to log out. Please try again.', 'error');
    return;
  }
  await refreshAdminStatus();
  window.alert('Logged out.');
});

exportExcelBtn.addEventListener('click', async () => {
  const response = await fetch('/api/admin/me');
  const data = await response.json();
  if (!data.authenticated) {
    window.alert('Admin login required to export Excel.');
    return;
  }
  window.location.href = '/api/export/excel';
});

exportPdfBtn.addEventListener('click', async () => {
  const response = await fetch('/api/admin/me');
  const data = await response.json();
  if (!data.authenticated) {
    window.alert('Admin login required to export PDF.');
    return;
  }
  window.location.href = '/api/export/pdf';
});

refreshAdminStatus();
refreshDashboard();
refreshStorageStatus();
