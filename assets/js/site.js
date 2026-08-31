/* mitanshu.dev — video behavior.
   1) Videos autoplay (muted, looping) while on screen, pause off screen.
   2) A manual pause sticks until the visitor plays again.
   3) Unmuting one video mutes all the others — one soundtrack at a time.
   4) Card videos prefetch one viewport ahead, so playback starts already
      buffered; if the network still stalls, a BUFFERING tick shows in the
      viewfinder corner.
   5) Save-Data and prefers-reduced-motion: no autoplay, no prefetch —
      posters + click-to-play. */

/* scroll reveal — fade/rise elements in as they enter; stagger via --i.
   The .reveal-on gate + inline backstop (in the page head) mean content still
   shows if this never runs, and reduced-motion shows everything at once. */
(function () {
  "use strict";
  var els = document.querySelectorAll(".reveal");
  if (!els.length) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    for (var i = 0; i < els.length; i++) els[i].classList.add("is-in");
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add("is-in"); io.unobserve(entry.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  els.forEach(function (el) { io.observe(el); });
})();

(function () {
  "use strict";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var saveData = !!(conn && conn.saveData);
  var videos = Array.prototype.slice.call(document.querySelectorAll("video"));
  if (!videos.length) return;

  /* one soundtrack at a time */
  videos.forEach(function (v) {
    v.addEventListener("volumechange", function () {
      if (!v.muted) {
        videos.forEach(function (other) {
          if (other !== v) other.muted = true;
        });
      }
    });
  });

  /* buffering tick on the media frame while the network can't keep up */
  videos.forEach(function (v) {
    var frame = v.parentElement;
    if (!frame) return;
    var show = function () { frame.classList.add("is-buffering"); };
    var hide = function () { frame.classList.remove("is-buffering"); };
    v.addEventListener("waiting", show);
    v.addEventListener("stalled", function () { if (!v.paused) show(); });
    v.addEventListener("playing", hide);
    v.addEventListener("canplay", hide);
    v.addEventListener("pause", hide);
    v.addEventListener("error", hide);
  });

  /* Card videos ship without `controls` so the grid is not seven browser
     chrome bars. Anywhere autoplay will not run, put the controls back — a
     poster with no way to play it is worse than the chrome. */
  function giveControls(list) {
    list.forEach(function (v) {
      v.setAttribute("controls", "");
      /* On the home page the whole card is a link laid over the media. A video
         with controls has to sit above that layer or the first tap navigates
         instead of playing. */
      v.classList.add("has-controls");
    });
  }

  if (reduced || saveData || !("IntersectionObserver" in window)) {
    giveControls(videos);
    /* no autoplay, no prefetch: posters + click-to-play, one at a time */
    if (saveData) {
      videos.forEach(function (v) { v.preload = "none"; });
    }
    videos.forEach(function (v) {
      v.addEventListener("play", function () {
        videos.forEach(function (other) {
          if (other !== v && !other.paused) other.pause();
        });
      });
    });
    return;
  }

  /* autoplay in view, pause out of view, respect a manual pause.
     Videos marked data-no-autoplay (story pages, narration audio) stay click-to-play. */
  var autoVideos = videos.filter(function (v) { return !v.hasAttribute("data-no-autoplay"); });
  autoVideos.forEach(function (v) {
    v.muted = true;
    v.addEventListener("pause", function () {
      if (v.dataset.ioPause) {
        delete v.dataset.ioPause;
      } else if (!v.ended) {
        v.dataset.userPaused = "1";
      }
    });
    v.addEventListener("play", function () {
      delete v.dataset.userPaused;
    });
  });

  /* prefetch: start buffering one viewport ahead of the scroll.
     One video at a time — parallel fetches starve whichever clip is
     already playing. */
  var queue = [];
  var pumping = false;
  function pump() {
    if (pumping) return;
    var v = queue.shift();
    if (!v) return;
    pumping = true;
    var done = function () {
      clearTimeout(timer);
      v.removeEventListener("canplaythrough", done);
      pumping = false;
      pump();
    };
    var timer = setTimeout(done, 5000); /* never let one slow fetch jam the queue */
    v.addEventListener("canplaythrough", done);
    v.preload = "auto";
    if (v.readyState >= 4) done();
  }
  var prefetch = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        queue.push(entry.target);
        prefetch.unobserve(entry.target);
        pump();
      }
    });
  }, { rootMargin: "600px 0px" });
  autoVideos.forEach(function (v) { prefetch.observe(v); });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var v = entry.target;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
        if (!v.dataset.userPaused && v.paused) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {
            /* Autoplay blocked by the browser (iOS low-power, a user setting).
               Give this one video its controls back rather than all of them. */
            v.setAttribute("controls", "");
            v.classList.add("has-controls");
          });
        }
      } else if (!v.paused) {
        v.dataset.ioPause = "1";
        v.pause();
      }
    });
  }, { threshold: [0, 0.3] });

  autoVideos.forEach(function (v) { io.observe(v); });
})();

/* Work filter — pills that narrow the grid by where each project was built.
   The filter row doubles as the experience index (company + count). */
(function () {
  var bar = document.querySelector(".org-filter");
  if (!bar) return;
  var cards = Array.prototype.slice.call(document.querySelectorAll(".work-card[data-org]"));
  var blurb = document.getElementById("orgBlurb");
  var empty = document.getElementById("gridEmpty");
  bar.addEventListener("click", function (e) {
    var btn = e.target.closest(".ofil");
    if (!btn) return;
    var f = btn.getAttribute("data-f");
    bar.querySelectorAll(".ofil").forEach(function (b) {
      b.setAttribute("aria-pressed", b === btn ? "true" : "false");
    });
    var shown = 0;
    cards.forEach(function (c) {
      var show = (f === "all") || (c.getAttribute("data-org") === f);
      c.classList.toggle("is-filtered", !show);
      if (show) shown++;
    });
    if (blurb && btn.getAttribute("data-blurb")) {
      blurb.textContent = btn.getAttribute("data-blurb");
    }
    if (empty) empty.hidden = shown > 0;
  });
})();

(function () {
  /* ---- theme toggle ------------------------------------------------
     Three states, not two: light, dark, and "whatever the system says",
     which is what you get before anyone touches the button. Clicking
     picks the opposite of what is currently on screen and stores it, so
     the system default keeps working for everyone who never clicks. */
  var tog = document.getElementById("themeTog");
  if (tog) {
    var root = document.documentElement;
    var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");

    function current() {
      var set = root.getAttribute("data-theme");
      if (set === "light" || set === "dark") return set;
      return systemDark && systemDark.matches ? "dark" : "light";
    }
    function sync() {
      var now = current();
      tog.setAttribute("aria-pressed", now === "light" ? "true" : "false");
      tog.setAttribute("aria-label", now === "light"
        ? "Colour theme: light. Switch to dark."
        : "Colour theme: dark. Switch to light.");
    }
    sync();

    /* <picture> resolves against prefers-color-scheme only, so a pinned theme
       cannot reach it. Setting img.src is not enough either — the selection
       algorithm re-runs and the <source> elements win again. Rewriting their
       media queries is what actually decides it: the sources for the scheme the
       reader did not pick are switched off with `not all`. */
    function fixFigures(theme) {
      var pics = document.querySelectorAll("picture");
      Array.prototype.forEach.call(pics, function (pic) {
        Array.prototype.forEach.call(pic.querySelectorAll("source"), function (src) {
          if (!src.dataset.media) src.dataset.media = src.getAttribute("media") || "";
          var m = src.dataset.media;
          if (m.indexOf("prefers-color-scheme") === -1) return;
          var isLight = m.indexOf("light") !== -1;
          src.setAttribute("media", (isLight === (theme === "light"))
            ? m.replace(/\(prefers-color-scheme:\s*\w+\)\s*and\s*/, "").replace(/^\(prefers-color-scheme:\s*\w+\)$/, "all")
            : "not all");
        });
        var img = pic.querySelector("img");
        if (img) { var s = img.getAttribute("src"); img.setAttribute("src", s); }
      });
    }
    fixFigures(current());

    tog.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
      fixFigures(next);
      sync();
    });

    /* If the reader never chose, follow the system when it changes mid-session
       (macOS and Windows both flip automatically at sunset). */
    if (systemDark && systemDark.addEventListener) {
      systemDark.addEventListener("change", function () {
        var stored = null;
        try { stored = localStorage.getItem("theme"); } catch (e) {}
        if (stored !== "light" && stored !== "dark") sync();
      });
    }
  }
})();
