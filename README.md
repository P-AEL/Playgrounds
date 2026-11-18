# Playground Atlas

An English playground map starting in **Copenhagen**, with shared visits and one shared rating per playground. The frontend runs on **GitHub Pages**. A small, independently hosted **Node.js API** stores the records in **MongoDB**. The same Node.js server can also serve the entire app.

## Features

- OpenStreetMap playgrounds and optional outdoor fitness/calisthenics spots, with search, filters and marker clustering.
- Visits with a date and time, including past visits. Timestamps are stored as UTC and displayed in the device's local time zone.
- One shared rating per OSM place ID: **Variety**, **Climbability**, **Pull ups possibility**, each an integer from **0 to 10**. Zero is a valid score. The overall score is the mean.
- Google Maps links to each spot's coordinates.
- A shared collection across devices, plus JSON export of the last loaded snapshot.
- Responsive desktop/mobile layout and keyboard support.

## How storage works

```text
GitHub Pages (browser) → HTTPS /api/atlas → MongoDB Atlas
```

The browser sends only playground metadata, ratings and visits. The MongoDB connection string and password stay on the backend. GitHub Pages serves static files; it does not run a Node.js process. A MongoDB connection string is not a browser HTTP endpoint.

The API is ordinary Node.js code: deploy it on your own server, run its Docker image, or use the optional Vercel adapter. There is no vendor-specific database SDK in the frontend.

## Setup

### Run your own backend locally

Requires Node.js 22 or newer.

1. Keep your local credentials in `atlas-credentials.env` or `.env`. These files are ignored by Git and excluded from the static build, Docker context and Vercel uploads.
2. Set the backend variables:

   | Variable | Purpose |
   | --- | --- |
   | `MONGODB_URI` | Complete Atlas URI with the database user's credentials; backend only |
   | `MONGODB_DB` | Optional database name, default `playground_atlas` |
   | `ALLOWED_ORIGINS` | Allowed browser origins, default `https://p-ael.github.io`; separate multiple origins with commas |
   | `HOST`, `PORT` | Listening address and port; default `127.0.0.1:4173` |

   See [`.env.example`](.env.example). Existing environment variables take precedence over local files. The supplied `MONGODB_USERNAME` and `MONGODB_PASSWORD` fields are not required separately when already included in `MONGODB_URI`.

3. Install and start:

   ```sh
   npm ci
   npm run check:db
   npm run dev
   ```

4. Open **http://127.0.0.1:4173**. This starts both the frontend and the real MongoDB API; the local app automatically uses its own backend.

The Atlas database user needs read/write access to the chosen app database. Add the backend server's outgoing IP address to the Atlas network access list. The API creates the visit lookup index automatically.

### Deploy on your own server with Docker

```sh
docker build -t playground-atlas .
docker run --env-file atlas-credentials.env -e ALLOWED_ORIGINS=https://p-ael.github.io -p 8080:8080 playground-atlas
```

The container runs as the unprivileged `node` user. It serves the app and API on port 8080. Put it behind your server's HTTPS reverse proxy and use its public HTTPS URL for the GitHub Page. Supply credentials at runtime; never bake them into the image.

Without Docker, run `npm ci --omit=dev`, `npm run build`, then `npm start` with `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT`, and the MongoDB variables set on the server. In production, credentials are read from the environment rather than local files.

### Render deployment

The live API is [playground-atlas-api.onrender.com](https://playground-atlas-api.onrender.com/api/atlas?resource=health), deployed from `main` as a **free Docker web service in Frankfurt**. Manage it in the [Render Dashboard](https://dashboard.render.com/web/srv-dbuf0t9srm7s73eltsb0). Its private environment holds `MONGODB_URI`; GitHub Pages receives only the public API URL.

The included `render.yaml` describes the same configuration for a future Blueprint setup. The existing service is managed directly through Render; committing this file does not create or synchronize a Blueprint. Keep future Dashboard and Blueprint settings consistent if you choose to adopt it.

Atlas network access permits the service's outbound ranges, currently `74.220.51.0/24` and `74.220.59.0/24`. Confirm them under **Connect → Outbound IP Addresses** in the service dashboard before changing the allowlist. These ranges are shared by other Render services in Frankfurt; database credentials are still required.

The free instance can sleep while idle. The frontend waits up to 90 seconds for a Render backend to wake before loading shared data. It never automatically retries a rating or visit write. Merges into `main` automatically deploy both Render and GitHub Pages.

### Optional: deploy the same backend on Vercel

1. Import this GitHub repository as a Vercel project. The included `vercel.json` configures the static build and Node.js function.
2. Add `MONGODB_URI`, optional `MONGODB_DB`, and `ALLOWED_ORIGINS=https://p-ael.github.io` as **server environment variables**.
3. Deploy. The app served by Vercel automatically uses its own API.
4. Confirm `https://YOUR_PROJECT.vercel.app/api/atlas?resource=health` returns `{"status":"ok","storage":"mongodb"}`.
5. Use that public backend origin in the GitHub Page configuration below.

This is a hosting option for the same custom backend, not a replacement database service. Vercel's [Hobby plan](https://vercel.com/docs/plans/hobby) is for personal, non-commercial projects. Atlas network access must allow connections from the selected hosting environment.

### Connect the existing GitHub Page

1. In **Settings → Secrets and variables → Actions → Variables**, set the public repository variable:

   | Name | Example |
   | --- | --- |
   | `ATLAS_API_URL` | `https://playground-atlas-api.onrender.com` |

2. Keep **Settings → Pages → Source → GitHub Actions**.
3. Run **Actions → Publish Playground Atlas → Run workflow**, or merge a change into `main`.

The frontend is published at [p-ael.github.io/Playgrounds](https://p-ael.github.io/Playgrounds/). Only the public backend URL is included in its build. **Never put `MONGODB_URI`, a database password, or the credentials ENV file into a public GitHub variable or commit.**

Until `ATLAS_API_URL` is set, the map still works and saving is explicitly disabled. Connection failures never fall back to local-only storage or falsely confirm a successful write.

## API

A single endpoint, `/api/atlas`, handles all operations:

| Request | Result |
| --- | --- |
| `GET ?resource=health` | Checks the database connection |
| `GET ?resource=places&limit=500&after=CURSOR` | A page of saved playgrounds and shared ratings |
| `GET ?resource=visits&limit=500&after=CURSOR` | A page of visits |
| `POST {action: "rate", place, rating}` | Upserts the rating for the stable OSM ID |
| `POST {action: "visit", place, visitedAt, visitId}` | Records a visit using an idempotent UUID |

List responses contain `items` and `nextCursor`. The browser loads all pages. Invalid coordinates, place IDs, ratings, future dates and oversized requests are rejected. Client-supplied database operators and extra fields are discarded. Database errors are returned without connection details or credentials.

MongoDB collections:

- `playgrounds`: OSM place ID as unique `_id`, public place metadata, the three rating values and `rated_at`.
- `playground_visits`: UUID as unique `_id`, `playground_id`, `visited_at` and `created_at`.

Visits do not overwrite ratings. Retrying the same visit UUID does not create a duplicate. All visitors share the same rating; the last successful rating update wins. The API exposes no delete action.

## Verification

```sh
npm test
npm run build
npm run check:db
node scripts/test-mongo.mjs
```

The regular test suite needs no external database. The last command is an optional integration test against your configured MongoDB. It uses two uniquely named disposable collections, verifies reads/writes through two HTTP clients, and removes only those test collections afterwards. It does not modify the app's records.

Cross-device check: save a visit and a rating on device A, open the site on device B, and confirm both appear. Data refreshes on opening, returning to the tab, every minute while visible, and manually through **Refresh shared data**.

## Shared access and costs

There are no individual user accounts: visitors can read the collection, change the shared rating and add visits. Visit times are public to visitors. CORS limits permitted browser origins but is not authentication; public API writes remain intentionally available without login.

[MongoDB Atlas Free](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) offers a limited free cluster and may pause after 30 days without connections. Backend hosting has its own limits. No paid hosting plan is required by this code.

## Map sources

The app queries `leisure=playground` and optional `leisure=fitness_station` from OpenStreetMap through Overpass. It uses the [Dresel mirror](https://ovp.dresel.systems/en/) with global FOSSGIS fallback. Search is limited to the visible area (at most 650 km² and 35 km per side), runs only on request, and does not guarantee complete coverage. The last English search result is cached for 24 hours locally. Ratings and visits always come from MongoDB.

Nominatim receives city searches only on form submission, without autocomplete. Map tiles are loaded only for interactive viewing; no offline/bulk tile downloads. Keep attribution visible. Public map services are best-effort and suitable for light usage; providers can be changed in `config.js`.

Policies: [OSM tiles](https://operations.osmfoundation.org/policies/tiles/), [Nominatim](https://operations.osmfoundation.org/policies/nominatim/), [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API). Google Maps is opened only via coordinate links; no Google place data is scraped.

Vendored libraries: Leaflet 1.9.4 ([license](assets/LEAFLET-LICENSE)) and MarkerCluster 1.5.3 ([license](assets/MARKERCLUSTER-LICENSE)). No external fonts or analytics trackers.
