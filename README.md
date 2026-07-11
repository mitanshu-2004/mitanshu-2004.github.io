# mitanshu.dev — v0.4 (plain, media-first, deploy-ready)

From-scratch portfolio. No framework, no build step: plain HTML + CSS + one small
JS file. Deploys anywhere static files go; wired for GitHub Pages + the custom
domain **mitanshu.dev** (CNAME, .nojekyll, 404, robots, sitemap all in place).

## Run locally

```bash
python3 -m http.server 4173 --directory /home/mitanshu/portfolio
# → http://localhost:4173
```

## Structure

- **Hero** — name, one plain sentence, open-to-roles status, and a telemetry
  readout of measured numbers from the projects below.
- **Work** — an equal grid, no featured card. Every card is a real video that
  autoplays muted while on screen, and every card expands to its own project page.
- **About / Contact** — three short paragraphs + skill lines; email + links.
- **Project pages** — `projects/`: `dual-arm-vr-teleop`, `tesollo-rps`, `hexapod`,
  `franka-teleop-dataset`, `manus-capture-sync`, `bodhi-humanoid` — big click-to-play
  video, "What you're watching / How it works / What broke, honestly / Links", then a
  **More media** gallery. Portrait phone clips use `.main-video.portrait` (capped
  height, letterboxed). Copy one for new projects.
- **Chat assistant** — an "Ask me anything" widget, grounded in the real projects,
  on every page. Backend is a small Cloudflare Worker proxying Groq; see
  `worker/README.md`. On localhost it uses `worker/dev-proxy.py`; in production it
  stays hidden until the Worker URL is filled into the `chat-endpoint` meta tag.
- **404.html**, `robots.txt`, `sitemap.xml`, `CNAME`, `.nojekyll`, `apple-touch-icon.png`.

## Media pipeline (the buffering fix)

Homepage cards use dedicated clips in `assets/media/*-card.mp4`, engineered to
start instantly and loop from cache:

- 8–15 s highlight cuts, 720 px wide max, H.264 CRF 27, `+faststart` (moov first),
  AAC 96k where the audio matters (bodhi keeps its voice; hexapod's silent track
  was stripped).
- Portrait sources (franka, manus, bodhi) are pre-cropped to the exact 16:9 band
  the card shows — no bytes spent on pixels `object-fit: cover` would discard.
- **Budget: ≤ 1.2 MB per card, ≤ 7 MB homepage total. Actual: 0.17–0.87 MB per
  card, ≈ 3.2 MB total** (was ~14 MB).
- Project pages keep the full-length demos (`dualarm-teleop-demo.mp4`,
  `tesollo-rps-demo.mp4`, `hexapod-sim-demo.mp4`), all fast-start.
- Full-length portrait originals (franka/manus/bodhi) are parked outside the repo
  until their project pages exist; sources remain on Mitanshu's hosting/YouTube.
- Hexapod canonical source: Mitanshu's YouTube upload xpnilti2U3U (Gazebo sim —
  labeled as sim everywhere). CAD still: Fusion 360 front elevation he supplied.

**To add a new video/photo:** drop the file in `assets/media/`, copy a `work-card`
(homepage) or `figure` (project gallery) block, change `src` + text. For a new
card clip, match the pipeline above (`ffmpeg -crf 27 -preset slow -movflags +faststart`,
trim to ~10 s, scale/crop to the 16:9 band, frame-0 poster).

## JS behaviors (`assets/js/site.js`)

- Videos autoplay muted + looping while ≥30 % on screen, pause off screen
  (IntersectionObserver); a manual pause sticks; unmuting one mutes the rest.
- A second observer prefetches card video one viewport ahead (`preload="auto"`)
  so playback starts already buffered.
- If the network still stalls, the top-left viewfinder mark becomes a pulsing
  BUFFERING tick (`.is-buffering` in site.css).
- `prefers-reduced-motion` and Save-Data: no autoplay, no prefetch — posters +
  click-to-play.
- Story-page videos (`data-no-autoplay`) stay click-to-play for the narration.

## Deploy (GitHub Pages — when Mitanshu says go; nothing pushed yet)

1. `git init && git add -A && git commit` in this folder, push to a public repo
   on github.com/mitanshu-2004.
2. Repo Settings → Pages → deploy from `main` / root. `CNAME` file already sets
   the custom domain to mitanshu.dev.
3. DNS at the registrar: apex `A` records → 185.199.108.153, 185.199.109.153,
   185.199.110.153, 185.199.111.153 (optional `www` CNAME → mitanshu-2004.github.io).
4. `.dev` is HSTS-preloaded — browsers require HTTPS. After DNS propagates,
   tick "Enforce HTTPS" (cert auto-issues; the domain won't load before that).

## Still needs Mitanshu's input (arriving over time, site ships without them)

- Real "What broke, honestly" stories — dual-arm, hexapod, tesollo pages have
  honest reserved slots.
- Real-hardware hexapod footage (sim clip + CAD are in; gallery slot waiting).
- The 51M nanoGPT's own training curve (the GPT card currently shows the Mistral 7B
  Reddit CPT loss, plotted from the repo's real `trainer_state.json`; the nanoGPT
  notebook was saved without outputs, so its curve needs a re-export).
- Deploy the chat Worker (his Cloudflare account) and fill the real `*.workers.dev`
  subdomain into the `chat-endpoint` meta tag on every page — steps in `worker/README.md`.
