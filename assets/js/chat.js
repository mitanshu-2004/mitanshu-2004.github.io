/* mitanshu.dev — ask-me-anything chat widget.
   Talks to the Cloudflare Worker (worker/src/chat.js) in production, or the local
   dev-proxy on localhost. The browser never holds a key. If no endpoint is configured
   in production, the widget quietly doesn't mount. */
(function () {
  "use strict";

  var LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var meta = document.querySelector('meta[name="chat-endpoint"]');
  var configured = meta && meta.content && meta.content.indexOf("YOURSUBDOMAIN") === -1;
  var ENDPOINT = LOCAL ? "http://localhost:8787/chat" : (configured ? meta.content : "");
  if (!ENDPOINT) return; // not wired up yet in production — no launcher

  var SUGGESTIONS = [
    "What has Mitanshu built?",
    "Tell me about the dual-arm teleop",
    "What's his ML work?",
    "Is he open to roles?"
  ];
  var GREETING =
    "Hey — I'm the assistant for Mitanshu's site. Ask about the robots, the ML, " +
    "or whether he'd fit a role you're hiring for.";

  var history = []; // real turns only (user + assistant), not the greeting
  var busy = false;
  var launch, panel, log, textarea, sendBtn, suggestWrap;

  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Escape first, then add only known-safe tags. Keeps model output from injecting HTML.
  function render(text) {
    var t = esc(text);
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi, '<a href="mailto:$1">$1</a>');
    t = t.replace(/(^|[\s(])(\/[a-z0-9/_-]+\.html)/gi, '$1<a href="$2">$2</a>');
    t = t.replace(
      /\b((?:github\.com|huggingface\.co|linkedin\.com|mitanshu\.dev)\/[^\s).]+(?:\.[^\s).]+)*)/gi,
      '<a href="https://$1" target="_blank" rel="noopener">$1</a>'
    );
    return t.split(/\n{2,}/).map(function (p) {
      return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function addMsg(who, text) {
    var m = el("div", "chat-msg " + who, text ? render(text) : "");
    log.appendChild(m);
    scrollDown();
    return m;
  }

  function mount() {
    launch = el("button", "chat-launch");
    launch.type = "button";
    launch.setAttribute("aria-label", "Ask about Mitanshu's work");
    launch.innerHTML = '<span class="dot"></span>Ask me anything';
    launch.addEventListener("click", open);

    panel = el("div", "chat-panel");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Chat about Mitanshu's work");
    panel.innerHTML =
      '<div class="chat-head">' +
        '<div class="who"><b>Mitanshu’s assistant</b><span>Grounded in his real work</span></div>' +
        '<button class="chat-close" type="button" aria-label="Close chat">✕</button>' +
      "</div>" +
      '<div class="chat-log" role="log" aria-live="polite"></div>' +
      '<div class="chat-suggest"></div>' +
      '<form class="chat-form">' +
        '<textarea rows="1" placeholder="Ask about a project, a skill, a role…" aria-label="Your message"></textarea>' +
        '<button class="chat-send" type="submit" aria-label="Send">↑</button>' +
      "</form>" +
      '<div class="chat-foot">AI assistant · grounded in his projects · can be wrong</div>';

    document.body.appendChild(launch);
    document.body.appendChild(panel);

    log = panel.querySelector(".chat-log");
    textarea = panel.querySelector("textarea");
    sendBtn = panel.querySelector(".chat-send");
    suggestWrap = panel.querySelector(".chat-suggest");
    panel.querySelector(".chat-close").addEventListener("click", close);
    panel.querySelector(".chat-form").addEventListener("submit", function (e) {
      e.preventDefault();
      send(textarea.value);
    });

    textarea.addEventListener("input", grow);
    textarea.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(textarea.value); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) close();
    });

    addMsg("bot", GREETING);
    SUGGESTIONS.forEach(function (q) {
      var b = el("button", null, esc(q));
      b.type = "button";
      b.addEventListener("click", function () { send(q); });
      suggestWrap.appendChild(b);
    });
  }

  function grow() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 96) + "px";
  }

  function open() {
    panel.hidden = false;
    launch.hidden = true;
    setTimeout(function () { textarea.focus(); }, 30);
  }
  function close() {
    panel.hidden = true;
    launch.hidden = false;
    launch.focus();
  }

  function hideSuggest() { if (suggestWrap) suggestWrap.style.display = "none"; }

  async function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    textarea.value = "";
    grow();
    hideSuggest();
    addMsg("me", text);
    history.push({ role: "user", content: text });

    busy = true;
    sendBtn.disabled = true;
    var bot = addMsg("bot", "");
    var cursor = el("span", "cursor");
    bot.appendChild(cursor);
    var acc = "";

    try {
      var res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history })
      });

      if (!res.ok || !res.body) {
        var msg = "Something went wrong. Try again in a moment, or email mitanshug2004@gmail.com.";
        try { var j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
        cursor.remove();
        bot.classList.add("err");
        bot.innerHTML = render(msg);
        return;
      }

      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var i;
        while ((i = buf.indexOf("\n")) >= 0) {
          var line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line.indexOf("data:") !== 0) continue;
          var d = line.slice(5).trim();
          if (d === "[DONE]") continue;
          try {
            var obj = JSON.parse(d);
            var piece = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
            if (piece) {
              acc += piece;
              bot.innerHTML = render(acc);
              bot.appendChild(cursor);
              scrollDown();
            }
          } catch (e) {}
        }
      }
      cursor.remove();
      bot.innerHTML = render(acc || "…");
      if (acc) history.push({ role: "assistant", content: acc });
    } catch (e) {
      cursor.remove();
      if (!bot.classList.contains("err")) {
        bot.classList.add("err");
        bot.innerHTML = render("Connection hiccup — try again, or email mitanshug2004@gmail.com.");
      }
    } finally {
      busy = false;
      sendBtn.disabled = false;
      scrollDown();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
