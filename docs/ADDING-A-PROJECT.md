# Adding a project

The content model is deliberately boring: a **work card** on the homepage links to a
**project page**, and two metadata files list it. Copy an existing one.

## 1. Media

Put assets in `assets/media/`. For the homepage card clip, encode to spec:

```bash
scripts/encode-card-clip.sh source.mp4 assets/media/<slug>-card.mp4 \
  --start 1 --dur 8 --crop W:H:X:Y      # crop optional
```

This produces a ≤1.2 MB, fast-start, muted clip plus `<slug>-card-poster.jpg`.
Keep clips short (~8 s) and body/irrelevant content out of frame.

## 2. Work card (homepage)

In `index.html`, copy a `<article class="work-card">` block inside `.work-grid` and
edit it. Required pieces:

```html
<article class="work-card reveal" data-org="<org>" style="--i:N">
  <div class="media">
    <video src="/assets/media/<slug>-card.mp4" poster="/assets/media/<slug>-card-poster.jpg"
           controls muted loop playsinline preload="metadata" aria-label="..."></video>
  </div>
  <div class="card-body">
    <h3><a href="/projects/<slug>.html">Title</a></h3>   <!-- the <a> makes the whole card clickable -->
    <p>One honest sentence about what it is and what you did.</p>
    <div class="chips"><span class="chip hot">Headline</span><span class="chip">Tool</span></div>
    <span class="more-link">Full story →</span>
  </div>
</article>
```

- `data-org` must be one of the filter values (`nferent`, `sarthak`, `nextup`,
  `personal`) — or add a new filter button in `.org-filter` and bump its count.
- The `<h3> <a>` is what makes the whole card a stretched link; don't remove it.
- `--i:N` sets the scroll-reveal stagger order.

If you add/rename an org, update the `.org-filter` buttons and the `All` count.

## 3. Project page

Copy an existing file in `projects/` (e.g. `nextup-cobot.html`) to
`projects/<slug>.html` and edit. Each page carries, in `<head>`:

- unique `<title>`, `<meta name="description">`, canonical + OG/Twitter tags,
- JSON-LD: a `BreadcrumbList` and (if it has video) a `VideoObject` with the real
  duration (`ffprobe -show_entries format=duration`) and a thumbnail.

Body sections, in order: crumb back to `/#work`, `.project-head` (title + chips +
lede), the main video, a "what I built / how it works" prose block, optional extra
media, and the shared footer. Keep the honest voice; label sim footage as sim.

## 4. Register it

- `sitemap.xml` — add a `<url>` with today's `lastmod`.
- `llms.txt` — add a line if it's a notable project.
- The chat assistant: add the project to `PROJECTS` in `worker/system-prompt.js` so
  the "ask me anything" widget knows about it (facts only, no embellishment).

## 5. Verify

```bash
make serve
# check: card autoplays + whole card opens the page (video still clickable),
#        filter includes it, project page has no console errors, looks right at
#        320 / 768 / 1440 widths, JSON-LD validates.
```
