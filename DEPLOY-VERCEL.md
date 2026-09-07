# A1K Task Tracker — GitHub + Vercel deployment (Turso edition)

This is the rewritten backend that makes the app deployable on Vercel. The
on-prem Windows deployment at your office (`Z:\A1K-Task-Tracker`,
`192.168.1.7:4100`) is untouched and keeps running — this is a second,
independent deployment for a public subdomain.

## What changed, and why

Vercel runs your API as serverless functions: no long-running process, no
local disk that survives between requests. The original app assumed both
(a single SQLite file on disk, an in-process `node-cron` schedule), so three
pieces were swapped for Vercel-compatible equivalents. Everything else —
every permission rule, every workflow rule, every screen — is unchanged.

| On-prem (Standard/SQLite) | This deployment (Vercel) |
|---|---|
| `better-sqlite3`, one `.db` file on disk | **Turso** — hosted, SQLite-wire-compatible database |
| Files on local disk (`UPLOAD_DIR`) | **Vercel Blob** |
| In-process `node-cron` sweep every 15 min | **Vercel Cron** hitting `/api/cron/alerts` |
| One process serves API + built client | API as serverless functions; client as a static build, same domain |

Three tradeoffs worth knowing about before this holds anything sensitive:

1. **Attachment "privacy" is now obscurity, not access control.** Vercel Blob
   has no private/authenticated-read mode — a blob's URL works for anyone who
   has it. Downloads still go through the authenticated `/api/attachments/:id`
   and `/api/chat/attachments/:id` routes (the app never hands out a raw Blob
   URL), and stored pathnames are long random tokens, not the original
   filename — but a determined person who obtained a URL could fetch it
   without signing in. The on-prem edition did not have this gap.
2. **Uploads are capped around 4 MB, not 20 MB.** A Vercel serverless
   function's own request body limit is 4.5 MB regardless of your own config;
   `MAX_UPLOAD_BYTES` is set to 4 MB here to fail cleanly rather than 413
   under the platform's own ceiling. Going bigger means moving to Vercel
   Blob's client-side direct-upload flow, which needs a small client change —
   worth doing later if 4 MB turns out to be too small.
3. **The alert sweep runs once a day on Vercel's Hobby plan**, not every 15
   minutes — that is Vercel Cron's minimum interval on Hobby; Pro allows any
   cadence. See `vercel.json`.

**Excel Edition (`STORE=workbook`) is not available on this deployment** — it
needs a persistent local file, which Vercel does not provide. It stays
available on the on-prem build.

## One-time setup

### 1. Turso (the database)

```
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create a1k-task-tracker
turso db show a1k-task-tracker --url          # → TURSO_DATABASE_URL
turso db tokens create a1k-task-tracker        # → TURSO_AUTH_TOKEN
```

### 2. A GitHub repository

From this project's root (the folder with this file in it):
```
git init
git add -A
git commit -m "A1K Task Tracker — Vercel/Turso edition"
```
Create an empty repo on GitHub (github.com/new, no README/license so it
stays empty), then:
```
git remote add origin https://github.com/<you>/a1k-task-tracker.git
git branch -M main
git push -u origin main
```

### 3. Vercel project

At vercel.com: **Add New → Project**, import that GitHub repo. Vercel reads
`vercel.json` and figures out the build automatically — you do not need to
change the framework preset.

Before the first deploy, add a **Blob store**: Project → Storage → Create →
Blob. Linking it to the project sets `BLOB_READ_WRITE_TOKEN` automatically.

Then, Project → Settings → Environment Variables, add:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | from step 1 |
| `TURSO_AUTH_TOKEN` | from step 1 |
| `JWT_SECRET` | a long random string — e.g. `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | `12h` |
| `REVIEW_SLA_DAYS` | `2` |

(`BLOB_READ_WRITE_TOKEN` is set for you by linking the Blob store above;
`BLOB_PREFIX` and `MAX_UPLOAD_BYTES` only need setting if you want to
override the defaults in `server/.env.example`.)

Deploy. Vercel gives you a `*.vercel.app` URL — confirm `/api/health`
responds there before moving to a custom subdomain.

### 4. Seed the database (once)

Locally, with `server/.env` filled in from `server/.env.example` (using the
same Turso values as step 3):
```
npm --prefix server install
npm --prefix server run seed
```
This runs against the same Turso database your Vercel deployment reads, so
seeding locally is enough — there is nothing to run "on the server".

### 5. Your subdomain

Project → Settings → Domains → add e.g. `tracker.cloudmojo.tech`. Vercel
gives you the DNS record to add (a `CNAME` to `cname.vercel-dns.com`, or an
`A` record if you're pointing the apex domain) — add it wherever
`cloudmojo.tech`'s DNS is managed. Propagation is usually minutes, sometimes
longer; Vercel issues the TLS certificate automatically once it sees the
record.

## After that

Every `git push` to `main` redeploys automatically. Local changes: edit,
`git add -A && git commit && git push`.
