# Setup & Operations Notes

## Required environment variables (Railway → Variables)

This app now depends on a Supabase project for anything that needs to survive
a redeploy (templates, the media library, the admin password, the live text
overlay). Without these three variables set, the server still runs, but
falls back to local files that Railway wipes on every redeploy.

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard → Project Settings → API → Project API keys → `service_role` (legacy JWT-style key, **not** the `anon` key) |
| `SESSION_SECRET` | Any long random string. Generate one with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |

Set the same three in a local `.env` file for development (see `.env.example`).
**Never commit `.env`** — it's gitignored on purpose.

This project shares its Supabase project with another app ("Bull Bay NTCOG
Games"). Everything this app owns is kept out of that app's way:
- tables `countdown_templates` and `countdown_settings` (prefixed, RLS on,
  no policies — only reachable with the service key, never from a browser)
- its own storage bucket, `countdown-media`

## Admin login

The admin panel at `/admin.html` requires a password (redirects to
`/login.html` otherwise). Change it any time from the **Account** section
at the bottom of the admin panel — you'll need the current password to set
a new one. If it's ever lost with no way to log in, generate a new hash and
upsert it directly into Supabase's `countdown_settings` table under the key
`admin_auth` (`{"salt": "...", "hash": "..."}`, produced by
`crypto.scryptSync`, see `lib/auth.js`).

## Media Library

Admin → **3. Background (Video / Image)** and **4. Background Music** let
you upload new files and switch what's live on every sanctuary screen
without touching code or redeploying. Files live in Supabase Storage
(`countdown-media` bucket), so they persist across redeploys and are shared
by every server instance. Max upload size: 50MB per file.

## OBS Text Display

A second, independent OBS browser source at `/text-overlay.html` — add it
as its own Browser Source in OBS, positioned wherever you like (it's fully
transparent, same as the countdown overlay at `/overlay.html`). Push lyrics,
an affirmation, or the passage being read from Admin → **5. OBS Text
Display**. "Clear from OBS" hides it without erasing what you typed, so you
can bring the same text back with one click.

## Templates

Saved from Admin → Edit Templates. Persisted to Supabase
(`countdown_templates`) so edits survive a Railway redeploy; a local
`templates.json` is kept only as an offline-development fallback and is not
the source of truth once Supabase is configured.
