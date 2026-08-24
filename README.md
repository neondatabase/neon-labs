# Neon Labs

## Neon Migration Assistant

A Postgres major-version upgrade assessment tool for Neon. Tells you
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
git clone https://github.com/neondatabase/neon-labs.git
cd neon-labs
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
Assessment is connection-only. An earlier "upload an offline bundle"
path let users run a collector script and upload the resulting ZIP;
it was removed because accepting archives from customers is an
unnecessary attack surface for a hosted deployment. Everything the
analyzer read from those archives came from catalog queries the live
path already runs.

### Reference
- **Extensions** — searchable reference of Neon's PG extension support,
  per major version.

Above 1 TB the results tell you to talk to Neon rather than plan a
migration yourself.

## Multi-user / sharing this with your team

The cleanest path right now is **everyone clones their own copy** and
points it at their own Neon org via their own `.env.local`. Their
credentials never touch your machine and vice versa.

A hosted multi-tenant version (labs.neon.com) needs a Neon partner
OAuth client. A shared server-side API key won't do: every visitor
would be acting as whoever owns that key, with read access to that
org's projects and connection URIs.

Two things in this repo assume single-tenant local use and need to
move to per-user OAuth tokens before hosting:

- `resolveApiKey()` falls back to the `NEON_API_KEY` environment
  variable, which under OAuth should come from the session instead.
- `NEON_SOURCE_CONNECTION_STRING` / `NEON_TARGET_CONNECTION_STRING`
  let the server skip the Neon API entirely. Hosted, every connection
  URI should be fetched per-request for the authorizing user.

The read-only scopes are enough: projects read plus connection URI
read. Nothing in the assessment flow writes.

## Security notes

- `.env.local` is gitignored. Don't commit it.
- Until OAuth is wired, an API key pasted into the local-development
  settings lives in `sessionStorage` and is cleared when the tab closes.
  Legacy `localStorage` credentials are removed automatically. Hosted,
  replace this fallback with an HttpOnly OAuth session.
- Connection strings in `.env.local` are read by the Next.js server
  process only. Project selection sends project ids; connection URIs are
  resolved per request, never returned to the browser, and never cached
  in application memory.
- Assessment results live only in React memory and disappear on refresh.
  Neon API responses are marked `Cache-Control: no-store`; this app has no
  database, analytics sink, or server-side persistence for customer data.
- Assessments run read-only catalog queries. Migration actions are
  explicitly separate and can create publications/subscriptions or copy
  data after user confirmation.

## Development

```bash
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint
```

Stack: Next.js 16 (App Router) + TypeScript + Tailwind CSS + `pg` for
direct Postgres connections.

## License

MIT.
