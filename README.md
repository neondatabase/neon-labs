# Neon Upgrade Advisor

A PostgreSQL major-version upgrade assessment tool for Neon. Tells you
what will break between two PG versions, which extensions are supported,
and which migration path fits your database, before you attempt it.

Built against the live Neon API. Runs against your own Neon projects.

## What this is, what this isn't

**Is:** a self-hosted Next.js app you clone and run locally. Talks to
your Neon projects through your own credentials (a Neon API key plus
your project connection strings).

**Isn't:** a hosted service. There's no `app.example.com` to sign into,
and there's no third-party server holding your tokens. Everything runs
on your machine, against your Neon org.

## What you'll need

1. A **Neon account** with at least one source project you want to
   assess or upgrade ([sign up](https://neon.com))
2. A **Neon API key** for that org ([generate one](https://console.neon.tech/app/settings/api-keys)).
   For multi-tenant safety, use an **org-scoped API key** rather than
   a personal one if you're testing this against shared projects.
3. Node.js 20+ and npm

That's it. No OAuth client provisioning, no third-party service.

## Quick start

```bash
git clone https://github.com/sav-maya/neon-pgupgrade-advisor.git
cd neon-pgupgrade-advisor
npm install --legacy-peer-deps
cp .env.example .env.local
# add your NEON_API_KEY (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

`NEON_API_KEY` is the only value the app needs. It lists your projects
and fetches their connection strings on demand, server-side.

## Configuring `.env.local`

Only `NEON_API_KEY` is required. Everything else is optional and just
skips a picker.

```env
# The only required value. Lists your projects and fetches their
# connection strings on demand.
NEON_API_KEY=napi_...

# Optional: skips the source project picker.
NEON_SOURCE_PROJECT_ID=your-source-project-id

# Optional override. Use the UNPOOLED host, no '-pooler' in the
# hostname, so introspection hits a direct compute.
NEON_SOURCE_CONNECTION_STRING=postgresql://neondb_owner:PASSWORD@ep-XXXX.region.aws.neon.tech/neondb?sslmode=require

# Optional: scopes the project list to an org and names it in the sidebar.
NEON_ORG_ID=org-...
NEON_ORG_NAME=My Org
```

**Where to find these values in the Neon Console:**

| Variable | Where |
|---|---|
| `NEON_SOURCE_PROJECT_ID` | Project URL: `console.neon.tech/app/projects/<this-bit>` |
| `NEON_SOURCE_CONNECTION_STRING` | Project → **Connect** button → copy the **direct** (not pooled) connection string |
| `NEON_ORG_ID` | Settings → Organizations → copy `org-...` ID |
| `NEON_ORG_NAME` | Just the display name |

## Features

### Assessment
- **Live introspection** of your source project's `pg_catalog` —
  detects breaking changes between source and target PG version,
  installed extensions, custom collations, public-schema writers,
  pl/pgsql functions used in expression indexes, etc.
- **Upload offline bundle** — for users who can't share a connection
  string (network restrictions, compliance). Download the included
  `customer_pg_assessment.sh` from the New Assessment page, run it on
  your DB host, upload the resulting ZIP.

### Reference
- **Extensions** — searchable reference of Neon's PG extension support,
  per major version.

Above 1 TB the results tell you to talk to Neon rather than plan a
migration yourself.

## Multi-user / sharing this with your team

The cleanest path right now is **everyone clones their own copy** and
points it at their own Neon org via their own `.env.local`. Their
credentials never touch your machine and vice versa.

A hosted multi-tenant version would need a Neon partner OAuth client.

## Security notes

- `.env.local` is gitignored. Don't commit it.
- The Neon API key lives in your browser's `localStorage` once you
  paste it in. It's only ever sent to this app's own `/api/*` routes,
  never to a third party.
- Connection strings in `.env.local` are read by the Next.js server
  process only. They aren't exposed to the browser.
- The app only reads. It runs catalog introspection against your source
  and never writes to your database.

## Development

```bash
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint
```

Stack: Next.js 16 (App Router) + TypeScript + Tailwind CSS + `pg` for
direct Postgres connections + JSZip for offline bundle parsing.

## License

MIT. The collector script (`public/customer_pg_assessment.sh`) is
adapted from [neondatabase/pg-prechecks](https://github.com/neondatabase/pg-prechecks)
(also MIT).
