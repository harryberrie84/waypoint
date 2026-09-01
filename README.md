# Waypoint

A self-hosted, end-to-end-encrypted workspace. Documents, a real database layer,
maps, and live collaboration, running out of a single container on your own box.

It started as a trip planner and grew into a place to run anything: a trip, a
household, a case file, a campaign, a small operation.

> Provided as-is, unsupported, no warranty. Use at your own risk, and back up your
> data.

AGPL-3.0. Run it, fork it, change it. If you run a modified copy as a service for
other people, publish your changes. See [LICENSE](LICENSE).

## Install

```bash
curl -O https://raw.githubusercontent.com/harryberrie84/waypoint/main/docker-compose.yml
docker compose up -d
```

Open `http://localhost:8090` and register. That account is yours; the first sign-in
seeds a starter workspace so the app is not an empty screen.

There is no schema to import, no database to prepare, and no build step. The
container builds its own database on first start.

To reach it from other devices, put it behind whatever you already use (a reverse
proxy, a tunnel, a VPN). The app serves its API and its frontend from the same
port, so nothing needs per-device configuration.

## What it does

- **Documents** with a block editor: text, headings, tables, checklists, code,
  math, diagrams, callouts, toggles, embeds.
- **A database layer**, not just tables. Eight views over the same rows (grid,
  board, gallery, calendar, timeline, map, route, schedule), plus formulas,
  relations, rollups and filters.
- **Maps and routes**, with places, pins, and travel times.
- **Live collaboration**: two people in the same document, with presence and
  comments. Encrypted pages sync live too.
- **End-to-end encryption**, per workspace. The server stores ciphertext and holds
  no key. See [cryptographicExplanation.md](cryptographicExplanation.md).
- **Canvases**: a mindmap and an automation flow.
- Spreadsheets, flashcards with spaced repetition, kanban boards, budgets that
  settle up, and import from Notion, Trello, Todoist, Google Keep and Anki.

## Configuration

Everything is optional. See [.env.example](.env.example).

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `docker-compose.yml` to have the
PocketBase admin account created on first start. Leave them out and PocketBase
prints a one-time setup link in `docker compose logs`. That admin account is for
the `/_/` dashboard (SMTP, backups), not for using the app.

**Email** (mention notifications, invites, reminders) needs SMTP credentials, set
in the admin dashboard under Settings. Without it the app works and the in-app
notification bell still does; only the emails are skipped.

Running it, in more detail (email, the calendar feed, backups, upgrading, and
running without Docker): [server/README.md](server/README.md).

## Your data

Everything lives in the `waypoint_data` volume: the database, uploaded files and
backups. Back it up by backing that up.

```bash
docker compose down
docker run --rm -v waypoint_data:/data -v "$PWD":/out alpine \
  tar czf /out/waypoint-backup.tar.gz -C /data .
docker compose up -d
```

The app also has its own workspace export under Settings, which produces a
readable zip rather than a database file.

## What talks to the internet

Self-hosting it should mean knowing what leaves the box. Nothing below is required
for the app to work, and all of it is triggered by you using a feature:

| What | When | Where |
|---|---|---|
| Map tiles | you open a map | OpenStreetMap |
| Place search | you search for a place | Nominatim (OSM) |
| Nearby search | you use "find nearby" on a map | Overpass (OSM) |
| Travel times | you use the Route view | the OSRM demo server, or your own via `VITE_OSRM_URL` |
| Weather | you add a place or a weather block | Open-Meteo |
| Exchange rates | you use a currency or budget block | open.er-api.com |
| Link previews | you paste a URL | **your own server** fetches that page and reads its title. The preview image and the site icon then load from wherever that site hosts them |
| Repository cards | you paste a github.com link | the public GitHub API, keyless |

Your documents are never sent to any of these. Nothing is sent anywhere for
analytics, telemetry, or crash reporting, because none of that exists here.

There is no font CDN and no icon CDN: the fonts are bundled in the image, all of
them under the SIL Open Font License, so an install with no route to the internet
renders exactly the same as one with. Link previews are read by your server for
the same reason, which is also why there is no API key to obtain for them.

## Upgrading

```bash
docker compose pull && docker compose up -d
```

Schema changes are applied by the container on start. Pin a version tag instead of
`latest` if you would rather choose when that happens, and roll back by pinning the
previous tag.

## Building it yourself

```bash
docker compose -f docker-compose.yml build   # after uncommenting `build: .`
```

Or without Docker: Node 18+ and the PocketBase 0.22.x binary.

```bash
npm install
npm run build          # produces dist/
npm run check          # typecheck, tests, lint, schema, assets
```

Copy `dist/*` into PocketBase's `pb_public/`, and `server/pb_hooks` and
`server/pb_migrations` alongside `pb_data`, then run
`pocketbase serve --http=0.0.0.0:8090`.

The schema is generated: `pocketbase/schema.json` is the source of truth and
`npm run schema:gen` rebuilds the bootstrap migration from it. `npm run check`
fails if the two have drifted.

**PocketBase 0.22.x, not 0.23+.** The server hooks use the 0.22 hook and DAO API,
which 0.23 renamed.

## Project layout

```
src/lib/         pure logic, no React and no store; this is the tested layer
src/store/       Zustand stores (pages, tables, rows, workspaces, vault)
src/components/  UI
src/editor/      editor nodes, widgets and the slash menu
server/README.md       running the server: email, backups, upgrades
server/pb_hooks/       PocketBase hooks (mention emails, invites, reminder cron,
                       link previews)
server/pb_migrations/  schema, including the generated bootstrap
pocketbase/schema.json the schema source of truth
scripts/         the test harness and the pre-ship gate
```

Tests are pure logic, run straight off the TypeScript source with no bundler and
no DOM:

```bash
node --import ./scripts/register.mjs scripts/tests.ts
```
