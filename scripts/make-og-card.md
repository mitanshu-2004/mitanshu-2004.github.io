# Regenerating the share card (`assets/media/og.jpg`)

The Open Graph / Twitter card is a **1200×630 screenshot of the live hero**, so it
always matches what the site actually looks like. To rebuild it after a hero change:

1. Serve the site (`make serve`) or use the live URL.
2. In a headless browser, set the viewport to exactly **1200×630**, load `/`,
   hide the floating chat button (`.chat-launch{display:none}`), scroll to top.
3. Screenshot the viewport (device scale) → save as `assets/media/og.jpg`
   (JPEG, quality 88, progressive, optimized). Confirm it is 1200×630.

All pages reference this one image via `og:image` + `twitter:image`. After updating
it, **push**, then re-scrape the URL in LinkedIn Post Inspector / Facebook Sharing
Debugger / X Card Validator to bust their caches.
