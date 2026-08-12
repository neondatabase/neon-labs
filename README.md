# Neon Upgrade Advisor

A PostgreSQL major-version upgrade assessment tool for Neon. Tells you
what will break between two PG versions, which extensions are supported,
and which migration path fits your database, before you attempt it.

Built against the live Neon API. Runs against your own Neon projects.

## What this is, what this isn't

**Is:** a Next.js app that uses per-user Neon OAuth when hosted. It can
also run locally with a development-only API key fallback.

**Isn't:** a service that stores customer catalog data or shares one
organization credential across visitors.

## What you'll need

1. A **Neon account** with at least one source project you want to
   assess or upgrade ([sign up](https://neon.com))
2. A **Neon OAuth client** for a hosted deployment, or a Neon API key
   for local development only.
3. Node.js 20+ and npm

## Quick start

```bash
git clone https://github.com/sav-maya/neon-pgupgrade-advisor.git
cd neon-pgupgrade-advisor
npm install
cp .env.example .env.local
# add OAuth credentials, or NEON_API_KEY for local development only
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuring `.env.local`

```env
# OAuth. Register http://localhost:3000/api/auth/callback/neon.
APP_URL=http://localhost:3000
NEON_OAUTH_CLIENT_ID=...
NEON_OAUTH_CLIENT_SECRET=...
SESSION_SECRET=at-least-32-random-characters

# Local-development fallback only. Ignored in production.
NEON_API_KEY=napi_...
NEON_SOURCE_PROJECT_ID=your-source-project-id
NEON_SOURCE_CONNECTION_STRING=postgresql://neondb_owner:PASSWORD@ep-XXXX.region.aws.neon.tech/neondb?sslmode=require
NEON_ORG_ID=org-...
NEON_ORG_NAME=My Org
```

Generate `SESSION_SECRET` with `openssl rand -base64 32`. In production,
set `APP_URL` to the stable custom domain, for example
`https://labs.neon.com`.

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

The hosted app uses a separate Neon OAuth session for every visitor.
A shared server-side API key is deliberately unsupported in production:
it would make every visitor act as the owner of that key.

The OAuth client requests project read/create/update and organization
read scopes. Assessment is read-only; migration tools need write scopes
to create targets and enable logical replication after confirmation.

## Security notes

- `.env.local` is gitignored. Don't commit it.
- OAuth access and refresh tokens are encrypted in an HttpOnly,
  `SameSite=Lax`, secure production cookie. The app has no session database.
- `NEON_API_KEY` and direct connection-string environment fallbacks are
  ignored in production.
- Project selection sends project ids. Connection URIs are resolved
  per request, never returned to the browser, and never cached in
  application memory.
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
