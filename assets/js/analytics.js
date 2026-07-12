/* Self-hosted, cookieless pageview beacon → Cloudflare Worker → D1.
   No cookies, no third-party scripts, no personal data. One tiny POST per page
   telling the Worker: which page, where you came from, and — if you arrived via a
   tagged link (?utm_source=...) — which link/company sent you. Country/city are
   added server-side from Cloudflare's edge headers. Fire-and-forget: if it fails,
   the page never notices. */
(function () {
  try {
    var fire = function () {
      // Guard against double execution (prerender activation, bfcache, etc.) —
      // one pageview must produce exactly one beacon.
      if (window.__mzSent) return;
      window.__mzSent = true;

      var ep = document.querySelector('meta[name="chat-endpoint"]');
      if (!ep) return;
      // Reuse the chat Worker's origin; hit its /collect route.
      var base = ep.getAttribute("content").replace(/\/chat\/?$/, "");
      var url = base + "/collect";

      var q = new URLSearchParams(location.search);
      var payload = {
        path: location.pathname,
        referrer: document.referrer ? new URL(document.referrer).host : "",
        utm_source: q.get("utm_source") || "",
        utm_medium: q.get("utm_medium") || "",
        utm_campaign: q.get("utm_campaign") || "",
        screen: (window.screen ? screen.width + "x" + screen.height : "")
      };
      var body = JSON.stringify(payload);
      // text/plain keeps it a "simple" request → no CORS preflight.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      } else {
        fetch(url, { method: "POST", body: body, keepalive: true, mode: "cors" });
      }
    };

    // Chrome may prerender the page before the visitor actually opens it;
    // count the view only when it becomes real.
    if (document.prerendering) {
      document.addEventListener("prerenderingchange", fire, { once: true });
    } else {
      fire();
    }
  } catch (e) { /* analytics must never break the page */ }
})();
