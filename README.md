# Roadwatch India

A dark, map-first road operations dashboard for browsing India and organizing verified road, contract, contractor, and inspection records.

## Data integrity

The map renders community-mapped OpenStreetMap roads as switchable vector layers through OpenFreeMap. **My location** zooms to the device position and opens a nearby-roads popup for a 1 km radius, listing up to 50 closest rendered OSM roads, mapped tags, nearby community reports, and any verified local-register records in the area. It also checks nearby live NHAI package alignments and displays available package, portal capital cost, delivery mode, progress, status, and dates; these nearby packages are shown separately and are not automatically matched to an OSM road. The popup's **Find PMGSY records in this area** action uses reverse geocoding to identify a likely state/district, then lets the user choose a block and a listed eMARG road record. Those records are relevant to the selected administrative area only: eMARG provides no road coordinates, so the app does not describe them as the nearest roads or attach them to OSM lines. Contract fields on OSM-only roads are explicitly shown as unavailable; a nearby verified record is not automatically claimed as belonging to a specific OSM line. The **Local + village roads** toggle highlights mapped minor, service, track, and path classes; the layer is community road geometry, not a separate official village-road register. The separate National Highways layer uses the 2024 GatiShakti snapshot published by bharatlas. The **NHAI projects** toggle loads live package alignments and project fields from NHAI Data Lake GIS as you zoom into an area; clicking a project line shows its package, state, NH, portal capital cost, delivery mode, progress, status, dates, and concession/project-entity field. The **PMGSY road records** lookup queries the public eMARG service by state, district, block, and road to show reported package, contractor, road length, maintenance period, maintenance expenditure, and eMARG inspection mark. On road selection, the map searches OSM for a likely named-road match; if none is credible, it zooms to the named block or, failing that, the district area where available and clearly labels that as approximate. The popup also links to a Google Maps search for the selected road and the user-provided Karnataka PMGSY-III Batch I clearance document; these references do not establish an official PMGSY-to-OSM road match or supply route geometry. eMARG's public lookup does not expose road geometry or construction award cost, so those records are not drawn as official geometries. OSM road coverage and detail vary by area and zoom; neither OSM nor the GatiShakti geometry is evidence of a road's contractor, original construction cost, current condition, or pothole count.

The local road register starts empty; the previous placeholder records have been removed. Unknown values stay unknown rather than being inferred from road type or filled with sample costs, contractors, or inspection dates. The register can store verified construction cost, contract reference, contractor, road length, inspection condition, and pothole count.

The in-app **Sources** desk now includes these open-data leads:

| Dataset | Useful for | Limitation |
| --- | --- | --- |
| [GeoSadak (PMGSY)](https://pmgsygeosadak.dord.gov.in/) | Official spatial data for rural roads covered by PMGSY | Scheme-scoped; public bulk export/API access was not confirmed. |
| [OMMAS (PMGSY)](https://pmgsy.dord.gov.in/) | Official PMGSY work execution, tendering, accounting, quality and monitoring system; likely source for construction/award details | PMGSY only. A public, stable road-level export/API and join to map geometry have not been verified or integrated. Sanctioned, awarded, and paid values must remain distinct. |
| [eMARG](https://emarg.gov.in/) | **Used by the PMGSY road-record lookup:** public state/district/block/road service returns road length, package, contractor, maintenance dates, maintenance expenditure, and an eMARG inspection mark where reported | PMGSY scheme scope. Public lookup fields do not include construction award cost or road geometry, and inspection marks are not converted to Roadwatch condition grades. A DLP/maintenance period is not a PPP concession term. |
| [MoRTH](https://morth.nic.in/) | Official National Highway administration, policy and published statistics | Official reports/statistics do not amount to a unified all-road centerline dataset. |
| [Central Public Procurement Portal (CPPP)](https://eprocure.gov.in/eprocure/app) | Central tender notices and procurement documents; search NHAI/MoRTH packages and check award/contract documents | Not all tenders are roads; verify award outcomes and final contract documents. A road-focused bulk award API/feed was not confirmed. |
| [NHAI Data Lake GIS Dashboard](https://datalakeg.nhai.gov.in/nhai/MISC/DataLakeGISDashboard) | **Used by the map now:** live package geometry and fields via its public GeoServer WFS `NHAI:adv_upc_wise_alignments_layers` layer | Loaded for the visible India map area, limited to 100 returned features per request and cached for 15 minutes. Capital cost is the portal field, not necessarily final awarded or paid amount; its concession/project-entity field is not a verified contractor field. |
| [ROADS INDIA](https://roadsindia.co.in/) | Commercially curated road-project and concession intelligence | Not a government or confirmed open-data source. Check price, provenance, license, and redistribution rights before use; not imported. |
| [GatiShakti national highways (2024), published by bharatlas](https://bharatlas.com/view/gs_highways) | India-wide National Highway centerline geometry, displayed through the PMTiles vector archive | National Highways only; the publisher reports CC0. Geometry is not a road-by-road contract or condition register. |
| [Dataful dataset 904](https://dataful.in/datasets/904/) | State- and year-level surfaced/total road-length statistics by category | Aggregate totals, not individual road geometry or contractor records. |
| [OpenStreetMap roads via OpenFreeMap](https://openfreemap.org/) | Community-mapped road features rendered as switchable map layers, including a highlight toggle for minor, service, track, and path classes; use **⌖ Karnataka** to zoom to the pilot area | Local/village classification is derived from OSM road classes, not an official village-road designation. Detail appears as you zoom in; coverage varies by area and zoom, so this is not a guaranteed complete inventory. Attribution and ODbL terms apply. It is not imported into the verified register. |
| [LGD state boundaries via bharatlas](https://bharatlas.com/api/dl/admin/states/LGD_States.geojson) | State/UT outline reference displayed over the basemap | Based on the publisher's 2024 LGD state polygons; not a Survey of India map. Confirm suitability before public release. |
| [NEDFI Northeast roadways](https://databank.nedfi.com/ne-infrastructure/roadways) | Northeast-region road statistics | Regional coverage only; detailed data requires registration. |

The OSM vector layer loads tiles for the area currently in view instead of downloading the full India extract into the browser. OpenFreeMap serves open OSM-derived vector tiles; map attribution is displayed by MapLibre. The National Highways layer reads the publisher's PMTiles archive using range requests; it does not download the approximately 147 MB GeoJSON into each browser session. The PMGSY lookup requests one user's selected administrative area and a selected road detail from eMARG; responses are cached for 15 minutes. Its OSM search uses the public Nominatim service, is throttled to one request per second, and caches results for 24 hours. It does not bulk import eMARG records or claim a complete national register. The app must not turn aggregate road lengths or mapped centerlines into claims about specific contracts, responsible contractors, construction cost, or current road condition. OSM remains community-mapped reference geometry, not an imported or verified road register.

### Contract-data acquisition plan

The app consumes NHAI package geometry and project fields directly from its public WFS, with spatial queries limited to the current map view. It also consumes selected PMGSY road, maintenance, contractor, and inspection fields from eMARG's public lookup. The lookup does not return a map geometry or construction award cost, and OMMAS award/work details are not yet integrated. A reliable spatial/package join is still required before PMGSY details can be attributed to individual OSM road lines.

Keep distinct source-backed values for road/package ID, length, sanctioned cost, awarded contract cost, contractor/consortium, execution status, award/start/appointed date, scheduled and actual completion dates, source document/reference, and contract-term type, duration, and end date. Preserve which source and date supports each value. **Awarded cost is not automatically the sanctioned estimate or final paid amount.** Distinguish PMGSY defect-liability/routine-maintenance terms from PPP concession periods; do not assume one standard duration from project mode alone. The current verified-record form has only a generic construction-cost field and a generic validity-in-months field, so it is not yet a sufficient normalized schema for importing both kinds of contract. Keep these values unknown until source documents support them.

Official Indian road data exists, but it is split across programmes and road-owning agencies: GeoSadak/OMMAS/eMARG cover different PMGSY rural-road functions, MoRTH publishes National Highway statistics, and state PWD/municipal bodies hold other road inventories. No public, unified official download covering every road class nationwide was confirmed. The app uses OSM for broad community-mapped reference roads, overlays live NHAI project packages, and provides an eMARG PMGSY road-detail lookup; PMGSY contract costs and road geometry and non-PMGSY state/local-agency records remain unintegrated.

Use **⌖ My location** to request the device's current position and center the map on it. Browser location permission is required. Coordinates are not saved in Roadwatch storage. Only when the user chooses **Find PMGSY records in this area**, the location is sent to OpenStreetMap Nominatim through the app's proxy to resolve the administrative area; the proxy caches a rounded coordinate lookup in memory for up to 24 hours.

OpenStreetMap roads are displayed as a switchable map layer but are not automatically fetched into or mixed with the verified register. The legacy `ENABLE_LIVE_GIS` full-India Overpass request is no longer used; it could replace persisted records and repeatedly send an unbounded query. The eMARG connection is an interactive, source-specific lookup, not a bulk import; the configurable government feed URLs below are placeholders and are not active. For records not covered by an integrated feed, enter facts with their evidence reference. Manually submitted records require a source reference. Custom-feed settings:

```bash
GOVERNMENT_GIS_URL=https://your-gis-endpoint.example/roads
ROAD_MAINTENANCE_URL=https://your-maintenance-endpoint.example/repairs
```

The app does not claim complete nationwide road-register coverage until authoritative sources for the relevant agencies are connected.

## Public community condition reports

Anyone can click a point on the map and publish one of five point-in-time road ratings: **Best**, **Good**, **Bad**, **Worse**, or **Worst**. The form offers a short plain-language guide for each choice. Reports are visible immediately and are always marked **community-reported**, never treated as official or professional inspections. A map marker summarizes reports at a nearby point; it does not identify or rate an entire road or prove a consensus. The marker shows the average, number and distribution of reports, and the latest report date. Other open map sessions refresh the markers every minute.

The report API accepts only a rating, mapped location, and limited OSM road metadata; it has no free-text field. Reports are stored separately from verified road records, contractor details, contract costs, and official inspections: MongoDB uses `road_tracker.condition_reports`, while local mode uses `data/condition-reports.json`. The endpoint applies an in-memory limit of five submissions per network address per ten minutes; the address is not persisted, and the limit resets when the server restarts. This is a lightweight anti-spam measure, not identity verification. Immediate-publication means abusive or mistaken ratings can still appear; no account or verification is implied.

## Karnataka pilot: official source leads

The in-app **Sources** control also links to these official Karnataka sources:

| Source | What it can establish | Current data limitation |
| --- | --- | --- |
| [PWD Planning & Road Asset Management Centre (PRAMC)](https://kpwd.karnataka.gov.in/57/pramc/en) | State PWD's road asset-management contact point | The official page lists the centre, but no public machine-readable road inventory was confirmed |
| [KSHIP project history](https://www.kship.in/en/history.aspx) | PWD highway-improvement programme, historical package lengths, project costs, and contract models | Published costs/lengths are project aggregates; they are not a road-by-road contract register |
| [Karnataka Road Development Corporation (KRDCL)](https://www.krdcl.in/en/home) | Government corporation responsible for road works and maintenance | No public road-level asset or contract feed was confirmed |
| [Karnataka Public Procurement Portal](https://kppp.karnataka.gov.in/) | Official procurement/tender portal | Structured award-result export and a stable public API were not confirmed |
| [State Highway Development Programme (SHDP)](https://www.shdpkar.in/en/home) | PWD state-highway improvement programme | Public material includes programme/project figures; a road-level export was not confirmed |

These are verified agency/portal leads, not verified datasets. The KSHIP profile includes historical project totals and delivery models, which must not be copied onto individual roads as if they were award records. To unlock a sourced import, the next external dependency is access to a road/package-level asset export and its award/inspection references from the responsible authority.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the app:
   ```bash
   npm start
   ```
3. Open http://localhost:3000

Manual road-record entry and exports require an operator password. Configure `ADMIN_PASSWORD` in the environment before using admin features; login remains disabled if it is unset. `ADMIN_USERNAME` defaults to `admin`. For example, in PowerShell:

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "<choose-a-strong-password>"
npm.cmd start
```

## MongoDB setup

The MongoDB Node.js driver is included. Without `MONGODB_URI`, the app clearly reports and uses the local JSON store. To use MongoDB:

1. Create a MongoDB Atlas cluster (or use an existing MongoDB server).
2. Create a database user and allow the development machine's IP in the Atlas network-access list.
3. Copy the application connection string. Keep its password private and URL-encode special characters in it.
4. In PowerShell, set it only in the current terminal session, then start the app:
   ```powershell
   $env:MONGODB_URI = "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
   npm.cmd start
   ```

   Do not commit the connection string or paste it into chat. The app reports `DB · MONGO` when connected and returns a visible storage error instead of silently writing to JSON if MongoDB is configured but unavailable. On the first MongoDB connection, existing JSON road records are copied into the MongoDB collection only if that collection is empty.

The map retains OpenStreetMap as its road basemap and overlays state/UT outlines from a 2024 LGD-derived dataset published by bharatlas. This is a reference overlay, not a Survey of India Political Map. Before public release, confirm that the boundary source and depiction are approved for the intended use; the [Survey of India Political Map of India](https://surveyofindia.gov.in/pages/political-map-of-india) remains the official reference.

## API endpoints

- `GET /api/roads`
- `GET /api/data-sources`
- `GET /api/road-data-sources`
- `GET /api/storage-status`
- `GET /api/pmgsy/location?lat=...&lng=...`
- `GET /api/pmgsy/states`
- `GET /api/pmgsy/districts?state=...`
- `GET /api/pmgsy/blocks?district=...`
- `GET /api/pmgsy/roads?district=...&block=...`
- `GET /api/pmgsy/road/:id`
- `POST /api/roads`
- `PUT /api/roads/:id`
- `DELETE /api/roads/:id`
- `GET /api/summary`
- `GET /api/contractors`

Manual road-record entry and exports require operator login.
