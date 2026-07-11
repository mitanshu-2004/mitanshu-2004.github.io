# mitanshu.dev

Personal portfolio for Mitanshu Goel — robotics & AI engineer. Hand-written, no
framework, no build step: plain HTML, one CSS file, one JS file, and a small
Cloudflare Worker for the chat assistant. Deploys anywhere static files go.

**Live:** https://mitanshu.dev/ (GitHub Pages; `mitanshu-2004.github.io` redirects here)

---

## Quickstart

```bash
make serve          # → http://localhost:4173  (python3 -m http.server)
```

No dependencies to install for the site itself. `ffmpeg` is only needed if you
re-encode media (see [Media pipeline](#media-pipeline)); `wrangler`/`python3`
only for the chat Worker (see [`worker/`](worker/)).

## What's here

```
.
├── index.html            # home: statement hero + filterable work grid
├── projects/             # one page per project (7)
├── assets/
│   ├── css/site.css      # all styles; design tokens at the top
│   ├── js/site.js        # video autoplay/prefetch + work filter
│   ├── js/chat.js        # "ask me anything" widget
│   ├── fonts/            # LSN Display (self-hosted woff2)
│   └── media/            # card clips, project videos, posters, images
├── worker/               # Cloudflare Worker: chat proxy to Groq (+ dev proxy)
├── docs/                 # ARCHITECTURE.md, ADDING-A-PROJECT.md
├── scripts/              # reproducible helpers (serve, encode a card clip)
├── 404.html  robots.txt  sitemap.xml  llms.txt  .nojekyll  favicon.svg
└── Makefile
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the design system, the
video-playback engineering, and how the pieces fit; **[docs/ADDING-A-PROJECT.md](docs/ADDING-A-PROJECT.md)**
to add a new work card + project page.

## The site, briefly

- **Hero** — a big-type statement, a coordinate stamp, and a numbered index of the
  three internships, framed by fiducial brackets. Striking with no photo or video.
- **Work** — an equal grid, filterable by where each project was built (Nferent AI /
  SarthakAI / NextUp / Personal). Every card is a short, muted, looping clip that
  autoplays on screen; the whole card opens its project page (the video stays
  interactive).
- **Project pages** (`projects/`) — a main video, "what I built / how it works /
  what broke, honestly", and supporting media. NextUp additionally shows a PyBullet
  sim of the real arm's URDF.
- **Chat assistant** — a grounded "ask me anything" widget on every page. Backend is
  a Cloudflare Worker proxying Groq; knowledge lives in `worker/system-prompt.js`.

## Media pipeline

Homepage cards use dedicated clips in `assets/media/*-card.mp4`, engineered to start
instantly and loop from cache. **Budget: ≤ 1.2 MB per card.** Reproduce the exact
encode with:

```bash
scripts/encode-card-clip.sh input.mp4 assets/media/name-card.mp4 \
  --start 1 --dur 8 --crop 1040:670:40:110
# → 720–800px wide, H.264 CRF 27, +faststart, muted, + frame-0 poster
```

Rules of the pipeline: trim to a ~8 s loop, crop/scale so no bytes are spent on
pixels `object-fit: cover` would discard, `-movflags +faststart` (moov atom first)
so the first frame paints before the file finishes downloading, and generate a
matching frame-0 poster. Details and rationale in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#media).

## Deploy (GitHub Pages)

This repo is the user site, so it serves at the domain root and the root-absolute
asset paths (`/assets/...`) resolve correctly.

```bash
git push origin main
# GitHub → repo Settings → Pages → Deploy from branch: main / root
```

`.nojekyll` disables Jekyll so files/dirs starting with `_` are served as-is.
To attach the custom domain later: add a `CNAME` file containing `mitanshu.dev`,
point apex `A` records at `185.199.108.153/109/110/111`, then enable "Enforce
HTTPS" (`.dev` is HSTS-preloaded, so HTTPS is mandatory and the cert must issue
before the domain loads).

The chat assistant needs its Worker deployed separately (Cloudflare account +
Groq key) and the `chat-endpoint` meta tag pointed at it — see [`worker/`](worker/).
Until then the widget stays quiet and the rest of the site is fully static.

## Reserved slots (ship-now, fill-later)

- "What broke, honestly" write-ups on several project pages.
- Real-hardware hexapod footage (Gazebo sim + CAD are in place).
- The 51M nanoGPT's own training curve (the card currently shows the Mistral-7B
  Reddit continued-pretraining loss, plotted from the repo's real `trainer_state.json`).
