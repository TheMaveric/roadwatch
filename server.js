const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let MongoClient = null;

try {
  ({ MongoClient } = require('mongodb'));
} catch (error) {
  console.warn('MongoDB not installed yet; continuing with file-based storage for now.');
}

const { listSources } = require('./services/roadDataService');

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const roadsFile = path.join(dataDir, 'roads.json');
const conditionReportsFile = path.join(dataDir, 'condition-reports.json');
const mongoUri = process.env.MONGODB_URI;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const sessionStore = new Map();
let mongoClient = null;
let mongoCollection = null;
let mongoConditionReportsCollection = null;
let mongoConnectionPromise = null;
let conditionReportWriteQueue = Promise.resolve();
const conditionReportRateLimit = new Map();
const nhaiProjectCache = new Map();
const pmgsyCache = new Map();
const pmgsyLocationCache = new Map();
const NHAI_PROJECTS_WFS_URL = 'https://datalakew.nhai.gov.in/geoserver/NHAI/wfs';
const EMARG_PUBLIC_BASE_URL = 'https://emarg.gov.in/public';
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
let nominatimRequestQueue = Promise.resolve();
let nominatimLastRequestAt = 0;
const pmgsyNearbyCache = new Map();
const CONDITION_RATINGS = {
  1: 'Best',
  2: 'Good',
  3: 'Bad',
  4: 'Worse',
  5: 'Worst',
};
const ROAD_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'residential',
  'unclassified',
  'service',
  'track',
  'path',
  'pedestrian',
  'living_street',
  'footway',
  'cycleway',
  'bridleway',
  'steps',
  'road',
  'street',
  'construction',
]);
const hasNumber = (value) => value !== null
  && value !== undefined
  && value !== ''
  && Number.isFinite(Number(value));
const ROAD_DATA_SOURCES = [
  {
    id: 'pmgsy-geosadak',
    name: 'GeoSadak · PMGSY rural-road GIS',
    organization: 'National Rural Infrastructure Development Agency · Government of India',
    url: 'https://pmgsygeosadak.dord.gov.in/',
    role: 'Official spatial data management for PMGSY rural-road projects',
    dataStatus: 'The official portal says it supports spatial road data collation, quality checks, editing, and serving for PMGSY. It is scheme-scoped, not a complete all-road map; public bulk export or API access was not confirmed.',
    priority: 1,
  },
  {
    id: 'pmgsy-ommas',
    name: 'OMMAS · PMGSY works and monitoring',
    organization: 'Department of Rural Development · Government of India',
    url: 'https://pmgsy.dord.gov.in/',
    role: 'PMGSY rural-road works, agreement, contractor, progress, and quality reporting',
    dataStatus: 'Official scheme portal and reports are a strong pilot lead. Validate report availability, awarded-versus-sanctioned values, downloadable formats, and road/package identifiers before importing; coverage is PMGSY only.',
    priority: 2,
  },
  {
    id: 'emarg-pmgsy',
    name: 'eMARG · PMGSY maintenance and inspections',
    organization: 'National Rural Infrastructure Development Agency · Government of India',
    url: 'https://emarg.gov.in/',
    role: 'PMGSY defect-liability-period and post-DLP routine maintenance monitoring',
    dataStatus: 'The public Know Your Road service supplies a state/district/block/road lookup with PMGSY road length, contractor, package number, maintenance start/end dates, maintenance expenditure, and its own inspection mark where available. The app proxies this public lookup. It does not provide a verified construction award amount or public road geometry, and covers PMGSY only.',
    priority: 3,
  },
  {
    id: 'morth',
    name: 'Ministry of Road Transport and Highways',
    organization: 'Government of India',
    url: 'https://morth.nic.in/',
    role: 'National Highway administration and official road statistics/reports',
    dataStatus: 'Official source for NH policy and published statistics. Reports and state/category totals are not a unified, downloadable road-centerline inventory of every road class.',
    priority: 4,
  },
  {
    id: 'cppp',
    name: 'Central Public Procurement Portal · eProcurement',
    organization: 'Government of India',
    url: 'https://eprocure.gov.in/eprocure/app',
    role: 'Central ministry and agency tender notices and procurement documents',
    dataStatus: 'Official tender portal; search for NHAI/MoRTH road packages and inspect award/contract documents for final values and contractors. A road-focused bulk award feed/API was not confirmed.',
    priority: 5,
  },
  {
    id: 'nhai-data-lake-gis',
    name: 'NHAI Data Lake · GIS Dashboard',
    organization: 'National Highways Authority of India',
    url: 'https://datalakeg.nhai.gov.in/nhai/MISC/DataLakeGISDashboard',
    role: 'National Highway package geometry, project progress, cost, mode, and schedule fields',
    dataStatus: 'Live project geometries and package fields are loaded in the map from NHAI Data Lake GIS (WFS layer adv_upc_wise_alignments_layers). Bounded to the visible map area; project cost is the portal capital-cost field, not necessarily final awarded or paid value.',
    priority: 1,
  },
  {
    id: 'roads-india',
    name: 'ROADS INDIA · project data repository',
    organization: 'Commercial data repository',
    url: 'https://roadsindia.co.in/',
    role: 'Commercially curated road-project and concession intelligence',
    dataStatus: 'Not a government or confirmed open-data source. Assess licensing, price, provenance, update frequency, and redistribution rights before considering use; not imported.',
    priority: 7,
  },
  {
    id: 'bharatlas-national-highways',
    name: 'National highways (2024)',
    organization: 'GatiShakti data · published by bharatlas',
    url: 'https://bharatlas.com/view/gs_highways',
    role: 'National highway centerline geometry',
    dataStatus: 'India-wide geometry snapshot; dataset page reports CC0. It covers National Highways only, not all roads or contract, cost, condition, or pothole records.',
    priority: 8,
  },
  {
    id: 'dataful-road-lengths',
    name: 'Year, State, Road Category wise Length of Total and Surfaced Roads',
    organization: 'Dataful · dataset 904',
    url: 'https://dataful.in/datasets/904/',
    role: 'State- and year-level road-length totals by category',
    dataStatus: 'Aggregate statistics for National Highways, State Highways, PWD, rural, urban, and project roads; no individual road geometry or contractor records.',
    priority: 9,
  },
  {
    id: 'openstreetmap-roads',
    name: 'OpenStreetMap roads · OpenFreeMap vector tiles',
    organization: 'OpenStreetMap contributors · tiles served by OpenFreeMap',
    url: 'https://openfreemap.org/',
    role: 'Community-mapped roads, including local and village-road classes, rendered as switchable map layers',
    dataStatus: 'Loads OSM-derived transportation vector tiles for the map view. The local/village toggle highlights OpenFreeMap transportation classes such as minor, service, track, and path; mapped coverage and detail vary by area and zoom. Not a guaranteed complete inventory and does not establish award value, contractor, or road condition. OSM attribution and ODbL terms apply.',
    priority: 10,
  },
  {
    id: 'lgd-state-boundaries',
    name: 'India state & Union Territory boundaries (LGD 2024)',
    organization: 'Local Government Directory data · published by bharatlas',
    url: 'https://bharatlas.com/api/dl/admin/states/LGD_States.geojson',
    role: 'Reference outline for India and state boundaries',
    dataStatus: 'The publisher describes these as 2024 LGD polygons. This is a reference overlay, not a Survey of India political map; verify boundary policy before public release.',
    priority: 11,
  },
  {
    id: 'nedfi-roadways',
    name: 'Northeast India roadways',
    organization: 'North Eastern Development Finance Corporation',
    url: 'https://databank.nedfi.com/ne-infrastructure/roadways',
    role: 'Regional road-length and development statistics',
    dataStatus: 'Northeastern Region only; detailed content requires registration, so it is not a nationwide open road inventory.',
    priority: 12,
  },
  {
    id: 'pramc',
    name: 'Planning & Road Asset Management Centre',
    organization: 'Karnataka Public Works Department',
    url: 'https://kpwd.karnataka.gov.in/57/pramc/en',
    role: 'Road asset-management lead',
    dataStatus: 'Official office page verified; public road-level dataset not yet confirmed.',
    priority: 13,
  },
  {
    id: 'kship',
    name: 'Karnataka State Highways Improvement Project',
    organization: 'PWD · Project Implementation Unit',
    url: 'https://www.kship.in/en/history.aspx',
    role: 'Highway project portfolio and implementation history',
    dataStatus: 'Project-level lengths, costs, and delivery models published; road/package-level export needs verification.',
    priority: 14,
  },
  {
    id: 'krdcl',
    name: 'Karnataka Road Development Corporation',
    organization: 'Government of Karnataka',
    url: 'https://www.krdcl.in/en/home',
    role: 'Road construction, improvement, and maintenance',
    dataStatus: 'Official corporation page verified; road-level asset and award feed not yet confirmed.',
    priority: 15,
  },
  {
    id: 'kppp',
    name: 'Karnataka Public Procurement Portal',
    organization: 'Government of Karnataka',
    url: 'https://kppp.karnataka.gov.in/',
    role: 'Tender and procurement notices',
    dataStatus: 'Official portal verified; award-result access and structured export need verification.',
    priority: 16,
  },
  {
    id: 'shdp',
    name: 'State Highway Development Programme',
    organization: 'PWD · Project Implementation Unit',
    url: 'https://www.shdpkar.in/en/home',
    role: 'State highway improvement programme',
    dataStatus: 'Programme information and aggregate project figures published; road-level export needs verification.',
    priority: 17,
  },
];

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sampleRoads = [];

const readRoads = () => {
  if (!fs.existsSync(roadsFile)) {
    fs.writeFileSync(roadsFile, JSON.stringify(sampleRoads, null, 2));
    return sampleRoads;
  }

  const raw = fs.readFileSync(roadsFile, 'utf8');
  if (!raw.trim()) return sampleRoads;

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Road data file must contain a JSON array.');
  }
  return parsed;
};

const writeRoads = (roads) => {
  const temporaryFile = `${roadsFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(roads, null, 2));
  fs.renameSync(temporaryFile, roadsFile);
};

const ensureMongoConnection = async () => {
  if (!mongoUri) return null;
  if (!MongoClient) {
    throw new Error('MongoDB is configured but the mongodb package is not installed.');
  }
  if (mongoCollection) return mongoCollection;

  if (!mongoConnectionPromise) {
    mongoConnectionPromise = (async () => {
      const client = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 5000,
      });
      try {
        await client.connect();
        const collection = client.db('road_tracker').collection('roads');
        await collection.createIndex({ id: 1 }, { unique: true });

        const count = await collection.countDocuments();
        if (count === 0) {
          const legacyRoads = readRoads();
          if (legacyRoads.length) {
            await collection.insertMany(legacyRoads.map(({ _id, ...road }) => road));
            console.log(`Migrated ${legacyRoads.length} road records from JSON to MongoDB.`);
          }
        }

        mongoClient = client;
        mongoCollection = collection;
        console.log('MongoDB connected.');
        return collection;
      } catch (error) {
        await client.close().catch(() => {});
        throw new Error(`MongoDB connection failed: ${error.message}`);
      }
    })().catch((error) => {
      mongoConnectionPromise = null;
      throw error;
    });
  }

  return mongoConnectionPromise;
};

const readRoadsFromStorage = async () => {
  const collection = await ensureMongoConnection();
  if (collection) {
    const documents = await collection.find({}).sort({ _id: -1 }).toArray();
    return documents.map((doc) => ({
      ...doc,
      id: doc.id || doc._id.toString(),
    }));
  }

  return readRoads();
};

const getConditionReportsCollection = async () => {
  const roadsCollection = await ensureMongoConnection();
  if (!roadsCollection) return null;
  if (mongoConditionReportsCollection) return mongoConditionReportsCollection;

  const collection = mongoClient.db('road_tracker').collection('condition_reports');
  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ submittedAt: -1 });
  mongoConditionReportsCollection = collection;
  return collection;
};

const readConditionReportsFromStorage = async () => {
  const collection = await getConditionReportsCollection();
  if (collection) {
    return collection.find({})
      .sort({ submittedAt: -1 })
      .limit(20000)
      .toArray();
  }

  if (!fs.existsSync(conditionReportsFile)) return [];
  const raw = fs.readFileSync(conditionReportsFile, 'utf8');
  if (!raw.trim()) return [];

  const reports = JSON.parse(raw);
  if (!Array.isArray(reports)) {
    throw new Error('Condition report file must contain a JSON array.');
  }
  return reports;
};

const saveConditionReport = async (report) => {
  const collection = await getConditionReportsCollection();
  if (collection) {
    await collection.insertOne(report);
    return;
  }

  const writeOperation = conditionReportWriteQueue.then(async () => {
    const reports = await readConditionReportsFromStorage();
    reports.unshift(report);
    const temporaryFile = `${conditionReportsFile}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(reports, null, 2));
    fs.renameSync(temporaryFile, conditionReportsFile);
  });
  conditionReportWriteQueue = writeOperation.catch(() => {});
  await writeOperation;
};

const buildConditionReportFeatures = (reports) => {
  const groups = new Map();

  reports.forEach((report) => {
    const roadName = report.roadName || '';
    const roadClass = report.roadClass || 'road';
    const bucketLat = Number((Math.round(report.lat * 10000) / 10000).toFixed(4));
    const bucketLng = Number((Math.round(report.lng * 10000) / 10000).toFixed(4));
    const locationKey = `${bucketLat}:${bucketLng}`;
    const groupKey = report.osmWayId
      ? `${roadClass}:${report.osmWayId}:${locationKey}`
      : `${roadClass}:${roadName.toLocaleLowerCase()}:${locationKey}`;
    const group = groups.get(groupKey) || {
      roadName,
      roadClass,
      osmWayId: report.osmWayId,
      latTotal: 0,
      lngTotal: 0,
      ratingTotal: 0,
      reportCount: 0,
      ratingCounts: [0, 0, 0, 0, 0],
      lastReported: report.submittedAt,
    };

    group.latTotal += report.lat;
    group.lngTotal += report.lng;
    group.ratingTotal += report.rating;
    group.reportCount += 1;
    group.ratingCounts[report.rating - 1] += 1;
    if (new Date(report.submittedAt) > new Date(group.lastReported)) {
      group.lastReported = report.submittedAt;
    }
    groups.set(groupKey, group);
  });

  return Array.from(groups.entries()).map(([groupKey, group]) => ({
    type: 'Feature',
    id: crypto.createHash('sha256').update(groupKey).digest('hex').slice(0, 24),
    properties: {
      roadName: group.roadName,
      roadClass: group.roadClass,
      osmWayId: group.osmWayId,
      averageRating: Number((group.ratingTotal / group.reportCount).toFixed(2)),
      ratingLabel: CONDITION_RATINGS[Math.min(5, Math.max(1, Math.round(group.ratingTotal / group.reportCount)))],
      reportCount: group.reportCount,
      ratingCounts: group.ratingCounts,
      lastReported: group.lastReported,
      communityReported: true,
    },
    geometry: {
      type: 'Point',
      coordinates: [
        Number((group.lngTotal / group.reportCount).toFixed(6)),
        Number((group.latTotal / group.reportCount).toFixed(6)),
      ],
    },
  }));
};

const isConditionReportRateLimited = (address) => {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const existing = (conditionReportRateLimit.get(address) || [])
    .filter((timestamp) => now - timestamp < windowMs);
  if (existing.length >= 5) {
    conditionReportRateLimit.set(address, existing);
    return true;
  }

  existing.push(now);
  conditionReportRateLimit.set(address, existing);
  if (conditionReportRateLimit.size > 10000) {
    conditionReportRateLimit.forEach((timestamps, key) => {
      if (!timestamps.length || now - timestamps[timestamps.length - 1] >= windowMs) {
        conditionReportRateLimit.delete(key);
      }
    });
  }
  return false;
};

const createRoadInStorage = async (road) => {
  const collection = await ensureMongoConnection();
  if (collection) {
    await collection.insertOne(road);
    return;
  }

  const roads = readRoads();
  roads.unshift(road);
  writeRoads(roads);
};

const updateRoadInStorage = async (id, changes) => {
  const collection = await ensureMongoConnection();
  if (collection) {
    const existing = await collection.findOne({ id });
    if (!existing) return null;
    const updated = { ...existing, ...changes, id };
    delete updated._id;
    await collection.updateOne({ id }, { $set: updated });
    return updated;
  }

  const roads = readRoads();
  const index = roads.findIndex((road) => road.id === id);
  if (index === -1) return null;
  roads[index] = { ...roads[index], ...changes, id };
  writeRoads(roads);
  return roads[index];
};

const deleteRoadFromStorage = async (id) => {
  const collection = await ensureMongoConnection();
  if (collection) {
    const result = await collection.deleteOne({ id });
    return result.deletedCount > 0;
  }

  const roads = readRoads();
  const remaining = roads.filter((road) => road.id !== id);
  if (remaining.length === roads.length) return false;
  writeRoads(remaining);
  return true;
};

const getCurrentRoads = async () => readRoadsFromStorage();

const buildContractorSummary = (roads) => {
  const grouped = new Map();

  roads.forEach((road) => {
    const contractor = road.contractor;
    if (!contractor) return;

    if (!grouped.has(contractor)) {
      grouped.set(contractor, {
        contractor,
        jobs: 0,
        totalCost: 0,
        totalValidity: 0,
        totalRoadKm: 0,
        ratingTotal: 0,
        ratedJobs: 0,
        validityJobs: 0,
        pricedRoadKm: 0,
        pricedJobs: 0,
      });
    }

    const entry = grouped.get(contractor);
    const rating = Number(road.contractorRating ?? road.rating);

    entry.jobs += 1;
    if (hasNumber(road.constructionCost)) {
      entry.totalCost += Number(road.constructionCost);
      entry.pricedJobs += 1;
      if (hasNumber(road.sizeKm)) {
        entry.pricedRoadKm += Number(road.sizeKm);
      }
    }
    if (hasNumber(road.validityMonths)) {
      entry.totalValidity += Number(road.validityMonths);
      entry.validityJobs += 1;
    }
    if (hasNumber(road.sizeKm)) {
      entry.totalRoadKm += Number(road.sizeKm);
    }
    if (Number.isFinite(rating) && rating > 0) {
      entry.ratingTotal += rating;
      entry.ratedJobs += 1;
    }
  });

  return Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      totalCost: entry.pricedJobs ? entry.totalCost : null,
      avgValidity: entry.validityJobs ? Number((entry.totalValidity / entry.validityJobs).toFixed(1)) : null,
      avgCostPerKm: entry.pricedRoadKm ? Math.round(entry.totalCost / entry.pricedRoadKm) : null,
      averageRating: entry.ratedJobs ? Number((entry.ratingTotal / entry.ratedJobs).toFixed(2)) : null,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);
};

app.use(express.json());
app.use((req, res, next) => {
  const cookies = Object.fromEntries((req.headers.cookie || '')
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf('=');
      return index === -1 ? [pair, ''] : [pair.slice(0, index), pair.slice(index + 1)];
    }));

  const token = cookies.road_session;
  if (token && sessionStore.has(token)) {
    req.session = sessionStore.get(token);
  } else {
    req.session = null;
  }

  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const requireAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    return next();
  }

  return res.status(401).json({ message: 'Admin login required.' });
};

app.get('/api/data-sources', (req, res) => {
  res.json(listSources());
});

app.get('/api/road-data-sources', (req, res) => {
  res.json(ROAD_DATA_SOURCES);
});

app.get('/api/nhai-projects', async (req, res) => {
  const bbox = typeof req.query.bbox === 'string'
    ? req.query.bbox.split(',').map(Number)
    : [];
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    return res.status(400).json({ message: 'A map bounding box is required.' });
  }

  const [west, south, east, north] = bbox;
  if (west < 68.1 || east > 97.4 || south < 6.7 || north > 37.1
    || west >= east || south >= north || east - west > 12 || north - south > 12) {
    return res.status(400).json({ message: 'The map bounding box is outside supported India coverage.' });
  }

  const cacheKey = bbox.map((value) => value.toFixed(3)).join(',');
  const cached = nhaiProjectCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 15 * 60 * 1000) {
    res.setHeader('Cache-Control', 'public, max-age=900');
    return res.json(cached.data);
  }

  const query = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'NHAI:adv_upc_wise_alignments_layers',
    outputFormat: 'application/json',
    count: '100',
    bbox: `${bbox.join(',')},EPSG:4326`,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${NHAI_PROJECTS_WFS_URL}?${query}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`NHAI GIS returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    if (!Array.isArray(result.features)) {
      throw new Error('NHAI GIS returned an invalid project dataset.');
    }

    const data = {
      type: 'FeatureCollection',
      features: result.features,
      source: 'NHAI Data Lake GIS · adv_upc_wise_alignments_layers',
      matched: Number(result.numberMatched) || result.features.length,
      truncated: Number(result.numberMatched) > result.features.length,
      retrievedAt: new Date().toISOString(),
    };
    nhaiProjectCache.set(cacheKey, { data, cachedAt: Date.now() });
    if (nhaiProjectCache.size > 100) {
      const oldestCacheKey = nhaiProjectCache.keys().next().value;
      nhaiProjectCache.delete(oldestCacheKey);
    }

    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json(data);
  } catch (error) {
    res.status(502).json({ message: 'Unable to load live NHAI project data.', error: error.message });
  } finally {
    clearTimeout(timeout);
  }
});

const getPmgsyCache = (key) => {
  const cached = pmgsyCache.get(key);
  if (cached && Date.now() - cached.cachedAt < 15 * 60 * 1000) return cached.data;
  if (cached) pmgsyCache.delete(key);
  return null;
};

const setPmgsyCache = (key, data) => {
  pmgsyCache.set(key, { data, cachedAt: Date.now() });
  if (pmgsyCache.size > 100) {
    pmgsyCache.delete(pmgsyCache.keys().next().value);
  }
};

const isEncodedPmgsyId = (value) => typeof value === 'string'
  && /^[A-Za-z0-9_-]{1,64}$/.test(value);

const isPmgsyLocationText = (value, maximumLength) => typeof value === 'string'
  && value.trim().length > 0
  && value.length <= maximumLength
  && !/[\u0000-\u001f<>]/.test(value);

const fetchNominatim = (endpoint, parameters) => {
  const request = nominatimRequestQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - nominatimLastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    nominatimLastRequestAt = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${NOMINATIM_BASE_URL}/${endpoint}?${new URLSearchParams(parameters)}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RoadwatchIndia/1.0 (public PMGSY map lookup)',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OpenStreetMap ${endpoint} returned HTTP ${response.status}.`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  });
  nominatimRequestQueue = request.catch(() => {});
  return request;
};

const fetchNominatimSearch = async (parameters) => {
  const results = await fetchNominatim('search', {
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'in',
    ...parameters,
  });
  if (!Array.isArray(results)) throw new Error('OpenStreetMap search returned invalid results.');
  return results;
};

const fetchNominatimReverse = (latitude, longitude) => fetchNominatim('reverse', {
  format: 'jsonv2',
  addressdetails: '1',
  zoom: '10',
  lat: String(latitude),
  lon: String(longitude),
});

const normalizeRoadNameTokens = (value) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\bmrl\s*[-/]?\s*\d+[a-z]?\b/gi, ' ')
  .toLowerCase()
  .match(/[a-z0-9]+/g)
  ?.filter((token) => token.length > 2 && !['road', 'route', 'via', 'from', 'to', 'the', 'and'].includes(token))
  || [];

const scoreOsmRoadName = (roadName, candidateName) => {
  const roadTokens = new Set(normalizeRoadNameTokens(roadName));
  const candidateTokens = new Set(normalizeRoadNameTokens(candidateName || ''));
  if (!roadTokens.size || !candidateTokens.size) return 0;
  const matches = [...candidateTokens].filter((token) => roadTokens.has(token)).length;
  return matches / candidateTokens.size;
};

const parseNominatimLocation = (candidate) => {
  const latitude = Number(candidate.lat);
  const longitude = Number(candidate.lon);
  const bbox = candidate.boundingbox?.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || longitude < 68.1 || longitude > 97.4 || latitude < 6.7 || latitude > 37.1
    || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    return null;
  }
  const [south, north, west, east] = bbox;
  if (west < 68.1 || east > 97.4 || south < 6.7 || north > 37.1
    || west > east || south > north) return null;
  return {
    name: candidate.name || candidate.display_name || null,
    center: [longitude, latitude],
    bounds: [[west, south], [east, north]],
  };
};

const fetchPmgsyPublicData = async (endpoint, parameters = {}) => {
  const cacheKey = `${endpoint}:${new URLSearchParams(parameters).toString()}`;
  const cached = getPmgsyCache(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${EMARG_PUBLIC_BASE_URL}/${endpoint}.do`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://emarg.gov.in/application_main.htm',
      },
      body: new URLSearchParams(parameters),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`eMARG returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    setPmgsyCache(cacheKey, data);
    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const unwrapPmgsyList = (response) => Array.isArray(response?.[0]) ? response[0] : response;

app.get('/api/pmgsy/states', async (req, res) => {
  try {
    const response = unwrapPmgsyList(await fetchPmgsyPublicData('getStateListForPublic'));
    if (!Array.isArray(response)) throw new Error('eMARG returned an invalid state list.');
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json(response.map((state) => ({
      id: state.encStateId,
      name: state.stateName,
    })).filter((state) => isEncodedPmgsyId(state.id) && typeof state.name === 'string'));
  } catch (error) {
    res.status(502).json({ message: 'Unable to load PMGSY states from eMARG.', error: error.message });
  }
});

app.get('/api/pmgsy/districts', async (req, res) => {
  const stateId = req.query.state;
  if (!isEncodedPmgsyId(stateId)) {
    return res.status(400).json({ message: 'A valid PMGSY state is required.' });
  }
  try {
    const response = unwrapPmgsyList(await fetchPmgsyPublicData('getDistrictListByState', { stateId }));
    if (!Array.isArray(response)) throw new Error('eMARG returned an invalid district list.');
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json(response.map((district) => ({
      id: district.encDistrictId,
      name: district.districtName,
    })).filter((district) => isEncodedPmgsyId(district.id) && typeof district.name === 'string'));
  } catch (error) {
    res.status(502).json({ message: 'Unable to load PMGSY districts from eMARG.', error: error.message });
  }
});

app.get('/api/pmgsy/blocks', async (req, res) => {
  const districtId = req.query.district;
  if (!isEncodedPmgsyId(districtId)) {
    return res.status(400).json({ message: 'A valid PMGSY district is required.' });
  }
  try {
    const response = unwrapPmgsyList(await fetchPmgsyPublicData('getBlockListByDistrict', { districtId }));
    if (!Array.isArray(response)) throw new Error('eMARG returned an invalid block list.');
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json(response.map((block) => ({
      id: block.encBlockId,
      name: block.blockName,
    })).filter((block) => isEncodedPmgsyId(block.id) && typeof block.name === 'string'));
  } catch (error) {
    res.status(502).json({ message: 'Unable to load PMGSY blocks from eMARG.', error: error.message });
  }
});

app.get('/api/pmgsy/roads', async (req, res) => {
  const districtId = req.query.district;
  const blockId = req.query.block;
  if (!isEncodedPmgsyId(districtId) || !isEncodedPmgsyId(blockId)) {
    return res.status(400).json({ message: 'Valid PMGSY district and block are required.' });
  }
  try {
    const response = unwrapPmgsyList(await fetchPmgsyPublicData('getRoadListByDistrictAndBlockId', {
      districtId,
      blockId,
    }));
    if (!Array.isArray(response)) throw new Error('eMARG returned an invalid road list.');
    const roads = response.map((road) => ({
      id: road.encRoadDetailsId,
      name: road.roadName,
    })).filter((road) => isEncodedPmgsyId(road.id) && typeof road.name === 'string');
    const maxRoads = 1000;
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json({ roads: roads.slice(0, maxRoads), truncated: roads.length > maxRoads });
  } catch (error) {
    res.status(502).json({ message: 'Unable to load PMGSY roads from eMARG.', error: error.message });
  }
});

app.get('/api/pmgsy/road/:id', async (req, res) => {
  if (!isEncodedPmgsyId(req.params.id)) {
    return res.status(400).json({ message: 'A valid PMGSY road identifier is required.' });
  }
  try {
    const result = await fetchPmgsyPublicData('getRoadDetailsByEncRoadDetailsId', {
      roadDetailsId: req.params.id,
    });
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('eMARG returned invalid PMGSY road details.');
    }
    const data = {
      roadName: result.roadName || null,
      packageNo: result.packageDetail?.packageNo || null,
      lengthKm: typeof result.actualLength === 'number' && Number.isFinite(result.actualLength)
        ? result.actualLength
        : null,
      btLengthKm: typeof result.btLength === 'number' && Number.isFinite(result.btLength)
        ? result.btLength
        : null,
      ccLengthKm: typeof result.ccLength === 'number' && Number.isFinite(result.ccLength)
        ? result.ccLength
        : null,
      contractor: result.contractorName || null,
      maintenanceStartDate: result.strMaintenanceStartDate || null,
      maintenanceEndDate: result.strStipulatedDateOfCompletion || null,
      maintenanceExpenditureRupees: typeof result.consolidatedGrossExpenditure === 'number'
        && Number.isFinite(result.consolidatedGrossExpenditure)
        ? result.consolidatedGrossExpenditure
        : null,
      inspectionMark: result.averageMarks || null,
      source: 'eMARG · PMGSY public Know Your Road service',
      sourceUrl: 'https://emarg.gov.in/',
      retrievedAt: new Date().toISOString(),
    };
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json(data);
  } catch (error) {
    res.status(502).json({ message: 'Unable to load PMGSY road details from eMARG.', error: error.message });
  }
});

app.get('/api/pmgsy/location', async (req, res) => {
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < 6.7 || latitude > 37.1 || longitude < 68.1 || longitude > 97.4) {
    return res.status(400).json({ message: 'A location within India is required to find PMGSY area records.' });
  }

  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const cached = pmgsyNearbyCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000) {
    res.setHeader('Cache-Control', 'public, max-age=900');
    return res.json(cached.data);
  }

  try {
    const result = await fetchNominatimReverse(latitude, longitude);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('OpenStreetMap reverse geocoding returned an invalid result.');
    }
    const address = result?.address;
    const localityCandidates = address
      ? [...new Set([
        address.city_district,
        address.municipality,
        address.county,
        address.town,
        address.village,
        address.suburb,
        address.city,
        address.hamlet,
      ].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
      : [];
    const data = {
      matched: Boolean(address?.state && (address.state_district || address.district || address.county)),
      state: address?.state || null,
      district: address?.state_district || address?.district || null,
      localityCandidates,
      source: 'OpenStreetMap contributors · Nominatim reverse geocoding',
    };
    pmgsyNearbyCache.set(cacheKey, { data, cachedAt: Date.now() });
    if (pmgsyNearbyCache.size > 1000) {
      pmgsyNearbyCache.delete(pmgsyNearbyCache.keys().next().value);
    }
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json(data);
  } catch (error) {
    res.status(502).json({ message: 'Unable to identify the administrative area for this location.', error: error.message });
  }
});

app.get('/api/pmgsy/road-location', async (req, res) => {
  const { road, block, district, state } = req.query;
  if (!isPmgsyLocationText(road, 300) || !isPmgsyLocationText(block, 100)
    || !isPmgsyLocationText(district, 100) || !isPmgsyLocationText(state, 100)) {
    return res.status(400).json({ message: 'Road, block, district, and state names are required.' });
  }

  const cacheKey = [road, block, district, state].map((value) => value.trim().toLowerCase()).join('|');
  const cached = pmgsyLocationCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000) {
    res.setHeader('Cache-Control', 'public, max-age=900');
    return res.json(cached.data);
  }

  try {
    const roadResults = await fetchNominatimSearch({
      q: `${road.trim()}, ${block.trim()}, ${district.trim()}, ${state.trim()}, India`,
    });
    const roadMatch = roadResults
      .filter((candidate) => candidate.category === 'highway'
        && normalizeRoadNameTokens(candidate.name || candidate.display_name).length >= 2
        && scoreOsmRoadName(road, candidate.name || candidate.display_name) >= 0.6)
      .map((candidate) => ({ candidate, location: parseNominatimLocation(candidate) }))
      .find((result) => result.location);

    let data;
    if (roadMatch) {
      data = {
        matchType: 'road-name-candidate',
        ...roadMatch.location,
        source: 'OpenStreetMap contributors · Nominatim',
        message: 'Likely OSM road-name match. Verify the alignment; this is not an official PMGSY geometry link.',
      };
    } else {
      const areaResults = await fetchNominatimSearch({
        city: block.trim(),
        state: state.trim(),
        country: 'India',
        featureType: 'settlement',
      });
      const findSettlement = (results, name) => results
        .filter((candidate) => candidate.category === 'place'
          && ['city', 'town', 'village', 'hamlet', 'municipality'].includes(candidate.type)
          && candidate.name?.trim().toLowerCase() === name.trim().toLowerCase()
          && (!candidate.address?.state || candidate.address.state.toLowerCase() === state.trim().toLowerCase()))
        .map((candidate) => parseNominatimLocation(candidate))
        .find(Boolean);
      let areaMatch = findSettlement(areaResults, block);
      data = areaMatch
        ? {
          matchType: 'block-area',
          ...areaMatch,
          source: 'OpenStreetMap contributors · Nominatim',
          message: `No likely OSM road-name match. Showing ${block.trim()} as an approximate area, not the exact road route.`,
        }
        : null;

      if (!data) {
        const districtResults = await fetchNominatimSearch({
          city: district.trim(),
          state: state.trim(),
          country: 'India',
          featureType: 'settlement',
        });
        areaMatch = findSettlement(districtResults, district);
        data = areaMatch
          ? {
            matchType: 'district-area',
            ...areaMatch,
            source: 'OpenStreetMap contributors · Nominatim',
            message: `No likely OSM road-name or block match. Showing ${district.trim()} district area as a broader reference, not the exact road route.`,
          }
          : {
            matchType: 'unavailable',
            source: 'OpenStreetMap contributors · Nominatim',
            message: 'No reliable road-name, block, or district-area match was found in OpenStreetMap.',
          };
      }
    }

    pmgsyLocationCache.set(cacheKey, { data, cachedAt: Date.now() });
    if (pmgsyLocationCache.size > 1000) {
      pmgsyLocationCache.delete(pmgsyLocationCache.keys().next().value);
    }
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json(data);
  } catch (error) {
    res.status(502).json({ message: 'Unable to search OpenStreetMap for this PMGSY road.', error: error.message });
  }
});

app.get('/api/storage-status', async (req, res) => {
  try {
    const collection = await ensureMongoConnection();
    res.json({
      provider: collection ? 'MongoDB' : 'Local JSON',
      connected: true,
    });
  } catch (error) {
    res.status(503).json({
      provider: 'MongoDB',
      connected: false,
      message: error.message,
    });
  }
});

app.get('/api/admin/me', (req, res) => {
  res.json({
    authenticated: Boolean(req.session && req.session.isAdmin),
    username: req.session && req.session.username ? req.session.username : null,
  });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ message: 'Admin login is disabled until ADMIN_PASSWORD is configured.' });
  }
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required.' });
  }

  const validUser = username === ADMIN_USERNAME;
  const validPassword = password === ADMIN_PASSWORD;

  if (!validUser || !validPassword) {
    return res.status(401).json({ message: 'Invalid admin credentials.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const sessionData = { isAdmin: true, username };
  sessionStore.set(token, sessionData);

  res.setHeader('Set-Cookie', `road_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 8}`);
  return res.json({ authenticated: true, username });
});

app.post('/api/admin/logout', (req, res) => {
  const cookies = Object.fromEntries((req.headers.cookie || '')
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf('=');
      return index === -1 ? [pair, ''] : [pair.slice(0, index), pair.slice(index + 1)];
    }));

  const token = cookies.road_session;
  if (token) {
    sessionStore.delete(token);
  }

  res.setHeader('Set-Cookie', 'road_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
  res.json({ loggedOut: true });
});

app.get('/api/roads', async (req, res) => {
  try {
    const roads = await getCurrentRoads();
    res.json(roads);
  } catch (error) {
    res.status(500).json({ message: 'Unable to load road data.', error: error.message });
  }
});

app.get('/api/condition-reports', async (req, res) => {
  try {
    const reports = await readConditionReportsFromStorage();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      type: 'FeatureCollection',
      features: buildConditionReportFeatures(reports).slice(0, 5000),
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load community condition reports.', error: error.message });
  }
});

app.post('/api/condition-reports', async (req, res) => {
  const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const rating = Number(payload.rating);
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  const roadClass = typeof payload.roadClass === 'string' ? payload.roadClass.trim().toLowerCase() : '';
  const roadName = typeof payload.roadName === 'string'
    ? payload.roadName.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    : '';
  const osmWayId = payload.osmWayId === undefined || payload.osmWayId === ''
    ? null
    : String(payload.osmWayId);

  if (!Number.isInteger(rating) || !CONDITION_RATINGS[rating]) {
    return res.status(400).json({ message: 'Choose a condition rating from Best to Worst.' });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < 6.7 || lat > 37.1 || lng < 68.1 || lng > 97.4) {
    return res.status(400).json({ message: 'Choose a road location within the India map coverage.' });
  }
  if (!ROAD_CLASSES.has(roadClass)) {
    return res.status(400).json({ message: 'The selected road type is not supported.' });
  }
  if (roadName.length > 120 || (payload.roadName !== undefined && typeof payload.roadName !== 'string')) {
    return res.status(400).json({ message: 'Road names must be 120 characters or fewer.' });
  }
  if (osmWayId !== null && !/^\d{1,30}$/.test(osmWayId)) {
    return res.status(400).json({ message: 'The mapped road reference is invalid.' });
  }

  if (isConditionReportRateLimited(req.socket.remoteAddress || 'unknown')) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ message: 'Please wait before submitting another community report.' });
  }

  const report = {
    id: `condition-${crypto.randomUUID()}`,
    lat,
    lng,
    rating,
    roadClass,
    roadName: roadName || '',
    osmWayId,
    submittedAt: new Date().toISOString(),
  };

  try {
    await saveConditionReport(report);
    res.status(201).json({
      id: report.id,
      rating,
      ratingLabel: CONDITION_RATINGS[rating],
      submittedAt: report.submittedAt,
      communityReported: true,
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to publish community report.', error: error.message });
  }
});

app.get('/api/contractors', async (req, res) => {
  try {
    const roads = await getCurrentRoads();
    res.json(buildContractorSummary(roads));
  } catch (error) {
    res.status(500).json({ message: 'Unable to load contractor data.', error: error.message });
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const roads = await getCurrentRoads();
    const pricedRoads = roads.filter((road) => hasNumber(road.constructionCost));
    const validRoads = roads.filter((road) => hasNumber(road.validityMonths));
    const totalCost = pricedRoads.reduce((sum, road) => sum + Number(road.constructionCost), 0);
    const avgValidity = validRoads.length
      ? validRoads.reduce((sum, road) => sum + Number(road.validityMonths), 0) / validRoads.length
      : null;

    const totalRoadKm = roads.reduce((sum, road) => sum + (Number(road.sizeKm) || 0), 0);
    const pricedRoadKm = pricedRoads.reduce((sum, road) => sum + (Number(road.sizeKm) || 0), 0);
    const avgCostPerKm = pricedRoadKm ? Math.round(totalCost / pricedRoadKm) : 0;

    res.json({
      totalRoads: roads.length,
      totalCost: pricedRoads.length ? totalCost : null,
      totalRoadKm,
      avgValidity: avgValidity === null ? null : Number(avgValidity.toFixed(1)),
      avgCostPerKm: pricedRoads.length ? avgCostPerKm : null,
      severeRoads: roads.filter((road) => ['Severe', 'Critical', 'Poor'].includes(road.condition)).length,
      activeContractors: new Set(roads.map((road) => road.contractor).filter(Boolean)).size,
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load road summary.', error: error.message });
  }
});

const escapeCsvValue = (value) => {
  const stringValue = String(value ?? '');
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
};

const exportRoadRows = (roads) => {
  const headers = ['name', 'area', 'condition', 'roadType', 'contractor', 'contractId', 'sourceReference', 'contractorRating', 'contractorScore', 'sizeKm', 'validityMonths', 'constructionCost', 'potholeCount', 'lastInspection', 'source'];
  const lines = [headers.join(',')];

  roads.forEach((road) => {
    lines.push(headers.map((header) => escapeCsvValue(road[header])).join(','));
  });

  return lines.join('\n');
};

const buildPdfDocument = (roads) => {
  const lines = [
    'Roadwatch India - Verified Road Records',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    '',
    ...roads.map((road, index) => {
      const cost = hasNumber(road.constructionCost) ? `INR ${road.constructionCost}` : 'Not verified';
      const potholes = hasNumber(road.potholeCount) ? road.potholeCount : 'Not inspected';
      return `${index + 1}. ${road.name} | ${road.area} | ${road.condition || 'Unverified'} | ${road.contractor || 'No contractor on file'} | Contract: ${road.contractId || 'Not on file'} | Built for: ${cost} | Potholes: ${potholes} | Source: ${road.sourceReference || road.source || 'Not on file'}`;
    }),
  ];

  const contentLines = lines.map((line, index) => {
    const text = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    return `BT /F1 12 Tf 50 ${760 - index * 18} Td (${text}) Tj ET`;
  });

  const content = contentLines.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const pdfParts = ['%PDF-1.4\n'];
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdfParts.join('')));
    pdfParts.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });

  const xrefOffset = Buffer.byteLength(pdfParts.join(''));
  pdfParts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);

  for (let i = 1; i <= objects.length; i++) {
    const offset = offsets[i];
    pdfParts.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }

  pdfParts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(pdfParts.join(''), 'binary');
};

app.get('/api/export/excel', requireAdmin, async (req, res) => {
  const roads = await getCurrentRoads();
  const csv = exportRoadRows(roads);

  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename=india-road-report.csv');
  res.send(csv);
});

app.get('/api/export/pdf', requireAdmin, async (req, res) => {
  const roads = await getCurrentRoads();
  const pdf = buildPdfDocument(roads);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=india-road-report.pdf');
  res.send(pdf);
});

app.post('/api/roads', requireAdmin, async (req, res) => {
  const payload = req.body;
  if (!payload.sourceReference || !String(payload.sourceReference).trim()) {
    return res.status(400).json({ message: 'An evidence or source reference is required.' });
  }
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ message: 'A valid latitude and longitude are required.' });
  }

  const newRoad = {
    id: payload.id || `road-${crypto.randomUUID()}`,
    name: payload.name || 'Unnamed Road',
    area: payload.area || 'Unspecified',
    condition: payload.condition || 'Unverified',
    roadType: payload.roadType || 'Local Road',
    sizeKm: payload.sizeKm === undefined ? null : Number(payload.sizeKm),
    contractor: payload.contractor || null,
    validityMonths: payload.validityMonths === undefined ? null : Number(payload.validityMonths),
    constructionCost: payload.constructionCost === undefined ? null : Number(payload.constructionCost),
    costEstimate: payload.costEstimate === undefined ? null : Number(payload.costEstimate),
    contractId: payload.contractId || null,
    sourceReference: String(payload.sourceReference).trim(),
    potholeCount: payload.potholeCount === undefined ? null : Number(payload.potholeCount),
    lastInspection: payload.lastInspection || null,
    lat,
    lng,
  };

  try {
    await createRoadInStorage(newRoad);
    res.status(201).json(newRoad);
  } catch (error) {
    res.status(500).json({ message: 'Unable to save road record.', error: error.message });
  }
});

app.put('/api/roads/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  if (payload.sourceReference !== undefined && !String(payload.sourceReference).trim()) {
    return res.status(400).json({ message: 'An evidence or source reference is required.' });
  }

  const changes = {};
  ['name', 'area', 'condition', 'roadType', 'contractor', 'contractId', 'sourceReference', 'lastInspection']
    .forEach((field) => {
      if (payload[field] !== undefined) changes[field] = payload[field];
    });
  ['sizeKm', 'validityMonths', 'constructionCost', 'potholeCount', 'lat', 'lng']
    .forEach((field) => {
      if (payload[field] !== undefined) {
        const value = Number(payload[field]);
        if (Number.isFinite(value)) changes[field] = value;
      }
    });

  try {
    const road = await updateRoadInStorage(id, changes);
    if (!road) return res.status(404).json({ message: 'Road not found.' });
    res.json(road);
  } catch (error) {
    res.status(500).json({ message: 'Unable to update road record.', error: error.message });
  }
});

app.delete('/api/roads/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteRoadFromStorage(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Road not found.' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ message: 'Unable to delete road record.', error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Road tracker running on http://localhost:${PORT}`);
});
