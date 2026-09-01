# Running the server

Everything here is optional. Waypoint works with none of it configured: you can
register, write, collaborate and encrypt without touching any of this. What is
below is what you set up when you want email, backups or an upgrade.

The container serves the app and the API from one port, and holds its whole
state in one volume. There is no second service to run.

## The admin dashboard

`http://your-host:8090/_/` is PocketBase's own dashboard. It is not the app: you
never need it to use Waypoint, only to configure the server.

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `docker-compose.yml` before the first
start and the account is created for you. Leave them out and PocketBase prints a
one-time setup link in `docker compose logs`.

## Email

Waypoint sends mail in three places, all through the server:

| When | What it sends |
|---|---|
| Someone @mentions you in a comment | a notification with a link to the page |
| Someone invites you to a workspace | an invite link |
| A reminder falls due | a short "this is due" note |

All three need SMTP. Set it in the dashboard under **Settings → Mail settings**:
host, port, username, password, and a from-address. Any provider works; there is
nothing Waypoint-specific about it.

**Without SMTP the app still works.** The hooks catch the send failure, log it,
and carry on: the comment is still posted, the invite is still created and can be
accepted from its link, and the in-app notification bell still fills up. Only the
email is skipped.

Password reset and email verification are PocketBase's own, and they use the same
settings.

## The calendar feed

A table can be subscribed to as a live calendar at `/ics/table/<table id>`. That
URL is **unauthenticated on purpose**, the same model as a Google Calendar private
address: anyone holding the link can read that table's dated rows. Treat it like a
password, and do not put one in a public place.

## Link previews

Pasting a link asks your own server to fetch that page and read its title. No
third-party metadata service is involved and there is no API key to get. The
endpoint requires a signed-in user, only follows http and https, and refuses
loopback, private, link-local and CGNAT addresses so it cannot be pointed at
machines behind your server.

If you would rather it not reach out at all, remove
`pb_hooks/link_preview.pb.js` from the image or the volume. Bookmarks then show
the link and its domain, which is what they fall back to when a site is
unreachable.

## Backups

Everything lives in one volume: the database, uploaded files, and PocketBase's
own backups. Back that up and you have backed up Waypoint.

```bash
docker compose down
docker run --rm -v waypoint_data:/data -v "$PWD":/out alpine \
  tar czf /out/waypoint-backup.tar.gz -C /data .
docker compose up -d
```

Restoring is the same in reverse, with the container stopped.

The dashboard also has **Settings → Backups**, which snapshots into the same
volume and can be scheduled. That is convenient but it is not off-site: a volume
you lose takes its backups with it.

The app has its own export too, under Settings in Waypoint itself, which produces
a readable zip of pages and tables rather than a database file. Encrypted content
is decrypted into that export, so unlock first and treat the file accordingly.

## Upgrading

```bash
docker compose pull && docker compose up -d
```

Schema changes are applied by the container on start, from the migrations bundled
in the image. Nothing to run by hand.

Pin a version tag instead of `latest` if you would rather choose when that
happens. Rolling back is pinning the previous tag and starting again; the volume
is untouched by either.

**PocketBase 0.22.x, not 0.23+.** The hooks use the 0.22 hook and DAO API, which
0.23 renamed. The image pins the version for this reason.

## Running without Docker

Put the built frontend in `pb_public/`, the contents of `server/pb_hooks` and
`server/pb_migrations` beside `pb_data`, then:

```bash
pocketbase serve --http=0.0.0.0:8090
```

The schema builds itself from the migrations on first start, the same as it does
in the container.
