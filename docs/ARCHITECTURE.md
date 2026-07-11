# Architecture

A static site by design. The whole thing is HTML you can read, one stylesheet, and
one behaviour script. The only moving part is a Cloudflare Worker for the chat
assistant, and the site works without it.

## Principles

- **No build step.** What's in the repo is what ships. Edit a file, refresh.
- **Root-absolute paths.** Every asset is referenced from `/` (e.g.
  `/assets/css/site.css`), so the site must be served from a domain root. That's why
  it lives in the `*.github.io` user repo, not a project repo (which would serve
  under `/reponame/` and break every path).
- **Progressive enhancement.** Content renders without JS. Video autoplay, the work
  filter, and the chat widget are enhancements layered on top; each degrades to a
  usable baseline (posters + click-to-play, a full unfiltered grid, no widget).
- **Honest by construction.** Sim footage is labelled sim; numbers are as measured;
  captions say what you're actually looking at.

## Design system (`assets/css/site.css`)

Tokens are declared once at the top of the stylesheet:

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#131110` | page background |
| `--bg-elev` | `#1C1815` | raised surfaces (cards) |
| `--ink` | `#EDE8E2` | primary text |
| `--muted` | `#A39B92` | secondary text |
| `--line` | `#2E2925` | decorative hairlines |
| `--line-strong` | `#756B60` | interactive borders (≥3:1 on bg) |
| `--accent` | `#FF6A2B` | the one accent, used sparingly |
| `--mono` / `--sans` | system stacks | labels vs body |

`"LSN Display"` (self-hosted woff2, preloaded) is the display face for headings.
A light-theme override lives under `@media (prefers-color-scheme)` / a `:root`
block near the bottom. When using `color-mix()`, ship an rgba fallback first for
older Safari/Firefox.

Motifs that carry meaning (not decoration): **fiducial brackets** (`.vf-*`, the
L-shaped corner marks — a machine-vision registration reference), a subtle film
grain, uppercase mono eyebrows, and hairline rules.

## Layout

- `.wrap` centres content at a max width with fluid gutters.
- The **hero** (`.hero`) is a statement + a right-hand experience index
  (`.hero-index`), collapsing to one column under 820px.
- The **work grid** (`.work-grid`) is an equal auto-fill grid of `.work-card`s.
  Each card is a stretched-link: `article.work-card` is the positioning context and
  `h3 a::after { position:absolute; inset:0 }` makes the whole card clickable, while
  `.media { z-index:2 }` keeps the video interactive above the link.
- The **filter** (`.org-filter`) toggles `data-org` on cards via
  `.is-filtered { display:none }`; logic in `site.js`.

## Video playback (`assets/js/site.js`)

The buffering problem — "videos should be playing, not spinning" — is solved in two
layers:

1. **Small, fast-start files.** Card clips are ≤1.2 MB with the moov atom first, so
   the first frame paints before the download finishes (see [Media](#media)).
2. **Prefetch + autoplay observers.** One `IntersectionObserver` upgrades a card's
   `preload` to `auto` one viewport ahead; a second plays it (muted, looping) at
   ≥30% visibility and pauses it off-screen. A manual pause sticks; unmuting one
   video mutes the rest. On a real stall the viewfinder corner shows a `BUFFERING`
   tick. `prefers-reduced-motion` and Save-Data fall back to posters + click-to-play.
   `data-no-autoplay` opts a video out (narration/story clips).

## Chat assistant (`worker/`, `assets/js/chat.js`)

`chat.js` reads the `<meta name="chat-endpoint">` URL and POSTs the conversation to
a Cloudflare Worker, which injects `SYSTEM_PROMPT` (from `worker/system-prompt.js`)
and proxies to Groq. The system prompt is the single source of truth for what the
assistant knows — grounded, no invented facts. Locally, `worker/dev-proxy.py` stands
in for the Worker and reads the same prompt file. Secrets live in
`worker/.dev.vars` (gitignored). If the endpoint is unset/unreachable the widget
stays quiet.

## Media

`assets/media/` holds three kinds of asset:
- **Card clips** `*-card.mp4` — ≤1.2 MB, 720–800px, muted, looping, `+faststart`,
  with a frame-0 `*-card-poster.jpg`.
- **Project videos** — longer demos on project pages, also fast-start.
- **Stills** — posters, CAD, charts.

Encode a card clip reproducibly with `scripts/encode-card-clip.sh` (wraps the exact
ffmpeg invocation). The NextUp sim clip is generated from the real robot's URDF with
PyBullet — see `scripts/` and the project page for provenance.

## Adding things

See [ADDING-A-PROJECT.md](ADDING-A-PROJECT.md) for the content model (a work card +
a project page + sitemap/JSON-LD). The project pages are deliberately copy-paste
templates — consistency over cleverness.
