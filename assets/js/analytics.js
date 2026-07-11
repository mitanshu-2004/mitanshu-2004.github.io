/* Cloudflare Web Analytics — privacy-first, cookieless page beacon.
   Free, no cookie banner, no personal data stored.

   Setup (one time):
     1. dash.cloudflare.com → Analytics & Logs → Web Analytics → "Add a site".
     2. Enter mitanshu.dev. Copy the token from the snippet it shows you
        (the value of "token" — a long hex string).
     3. Paste it into TOKEN below and redeploy.

   Until a real token is set this file does nothing (no network request), so the
   site ships clean and analytics turns on the moment you fill the token. The token
   lives here only, so it's the single place to update. */
(function () {
  var TOKEN = "CF_WEB_ANALYTICS_TOKEN"; // <-- replace with your Cloudflare token
  if (!TOKEN || TOKEN === "CF_WEB_ANALYTICS_TOKEN") return; // not configured — no-op
  var s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN }));
  document.head.appendChild(s);
})();
