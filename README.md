# KK Trails: Bukit Padang QR pilot

A web page (no app install) that opens from a QR code at the trailhead. It shows one preset trail on a map, follows you by GPS, buzzes before each junction, warns if you leave the trail, and can be saved for use with no signal. EN and BM.

This is the 4-week pilot from the market research (`ClaudeObsidian/outputs/market-research/2026-11-10 Trail navigator/`). Its only job is to answer the stop/go questions before any native app is built.

## Try it now (demo trail, no recording needed)

```bash
npm install
npm run dev
```

Open http://localhost:5173. The demo loop shows because you are in development.
Add `?sim=on` to a trail address to watch a pretend walk, or `?sim=off` for one that takes a wrong turn after the first junction and comes back.

```bash
npm test        # navigation logic tests
npm run build   # typecheck and build into dist/
```

## Add a real trail (your Suunto recording)

1. In the Suunto app, export the workout as **GPX**.
2. Mark each junction as a waypoint: in the GPX, add `<wpt>` entries (or add the waypoints in a GPX editor). Put the instruction in the description as `English | Bahasa Malaysia`, for example `Keep left at the big rock | Ikut kiri di batu besar`. For a photo, add `[photo:padang-t5/j1.jpg]` at the end and put the file in `public/photos/padang-t5/`.
3. Run:

```bash
npm run import-gpx -- padang-t5.gpx --id padang-t5 --hill "Bukit Padang" --name "Trail 5" --name-ms "Denai 5" --checked 2026-11-15 --hours "06:00–19:00"
```

It cleans the track, works out distance, climb and walking time (Naismith's rule), and writes `public/trails/padang-t5.json`. Record each trail 2–3 times and import the cleanest.

- It reads both recorded tracks and exported routes (Suunto "route" files).
- `--slice 0-1625` keeps only that stretch, in metres from the start. Use it when one recording covers several laps.
- **Junctions can live in `data/junctions/<id>.json`** instead of the GPX. Each entry is `{ "at": [lng, lat], "cue": { "en": "...", "ms": "..." }, "photo": "padang-t5/j1.jpg" }` (photo optional). If that file exists, the import uses it, so re-importing a better recording does not lose your junctions. Keep junctions more than about 55 m apart: a cue fires 40 m before and the junction counts as passed 15 m after.

**`padang-summit` was made this way, and its junctions are suggestions.** They came from the OpenStreetMap paths that leave the route (branches of 100 m or more), not from walking it. Walk the trail, then open `data/junctions/padang-summit.json` and fix, delete or add junctions and rewrite each cue to match the real signs and landmarks. The trail page warns users until you delete the `--status-note` from the import command.

To mark a trail closed or take-care: add `--status closed --status-note "Closed for construction" --status-note-ms "Ditutup untuk pembinaan"`. Re-run the import (or edit the two JSON files) and redeploy. Update the "checked" date every time you walk it.

## Put it online (free)

The site is static files in `dist/`. Cloudflare Pages is free and allows commercial use (Vercel's free plan does not).

1. Push the project to GitHub (you decide when; nothing is committed yet).
2. In Cloudflare Pages: connect the repo, build command `npm run build`, output folder `dist`.
3. The file `public/_redirects` makes `/t/<trail>` open the right page.

## Count the scans

1. Create a free Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Copy `.env.example` to `.env.local` and fill in the project URL and the **anon** key (Project settings, API). Add the same two values as build variables in Cloudflare Pages.
3. The query at the bottom of `schema.sql` gives the stop/go numbers. The site can only add rows, not read them.

Only a random visitor id, the trail id, the event name, the language and the source are stored. No location and no names.

## Print the QR codes

```bash
npm run qr -- https://your-site.pages.dev
```

Writes one SVG per real trail into `qr/`. The link ends in `?s=qr`, so scans are counted separately from other visits. Print with a short code under each (for example `PADANG-5`) in case a sticker is scratched, and get **written permission from DBKK** before putting anything up at Bukit Padang.

## What is not done yet

- Tested on a laptop with a pretend walk only. **Walk it on a real phone before printing anything**: the junction cue distance (40 m), off-route distance (25 m, three readings in a row) and the GPS accuracy limit (30 m) in `src/nav.ts` are starting values from the research.
- The browser stops tracking when the screen is off. The page asks the walker to keep it open and uses the screen-wake lock; battery use is not measured yet.
- `npm run qr` and the Supabase counting are written but not run against real data (no real trail or Supabase project yet).
- No real trails or junction photos yet.
- iOS Safari is untested.
- Map data credit "© OpenStreetMap contributors" shows on the map; keep it.
