// WRAITH practice lab -----------------------------------------------------
// A deliberately vulnerable, self-contained "support desk" mounted at /lab so a
// hook + Page Mirror run can be demonstrated end to end, same-origin with WRAITH.
//
//   Flow:
//   1. Attacker submits a ticket at /lab/  (the message field is a stored-XSS sink)
//   2. An agent "reviews the queue" at /lab/agent  -> the payload renders RAW and
//      fires  (this is the blind-XSS moment: you don't see the agent's screen)
//   3. From the WRAITH console, Page Mirror the hooked agent and click links to
//      browse /lab/agent/tickets, /users, /secrets -- fetched THROUGH the agent,
//      carrying their session cookie.
//
// Teaching hooks baked in:
//   * The agent session cookie is HttpOnly, so Page Capture CANNOT read it -- yet
//     the mirror still rides it, because the browser attaches it to same-origin
//     fetches. That is the point of HttpOnly, and its limit.
//   * /lab/agent/secrets requires that cookie, so it only resolves when fetched
//     through the victim, not by the operator directly.
//
// AUTHORIZED CLASSROOM / LAB USE ONLY. Intentionally insecure by design.

const express = require('express');
const router = express.Router();

// ---- in-memory ticket queue (lab data; resets on restart) ---------------
let seq = 1;
const tickets = [];
function addTicket(t) { const id = seq++; tickets.unshift({ id, at: Date.now(), ...t }); return id; }
addTicket({ subject: 'Payroll CSV export returns 500', from: 'm.chen@northwind.example',
  message: 'Exporting the payroll report has failed since Monday. Can an agent take a look?' });
addTicket({ subject: 'Duplicate contacts after sync', from: 'r.silva@northwind.example',
  message: 'The address book shows every contact twice since the last update.' });

const ADMIN_COOKIE = 'nw_agent';
const ADMIN_TOKEN = 'agent-9f83a1c4';
const SECRET_FLAG = 'NW-FLAG{ride_the_session_not_the_cookie}';

function cookies(req) {
  const out = {}, h = req.headers.cookie;
  if (h) h.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function when(t) { const s = Math.floor((Date.now() - t) / 1000); return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : Math.floor(s / 3600) + 'h ago'; }

// ---- shared layout ------------------------------------------------------
function page(opts) {
  const nav = (opts.nav || []).map(n =>
    `<a href="${n.href}"${n.active ? ' class="on"' : ''}>${esc(n.label)}</a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.title)}</title>
<style>
 *{box-sizing:border-box}
 body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
   color:#1c2430;background:#eef1f5}
 header{background:#0f2038;color:#fff;padding:0 22px;display:flex;align-items:center;gap:20px;height:56px;
   box-shadow:0 1px 0 rgba(0,0,0,.15)}
 header .logo{font-weight:800;letter-spacing:.5px;font-size:17px}
 header .logo span{color:#39c0ff}
 nav{display:flex;gap:4px;margin-left:8px}
 nav a{color:#c6d3e2;text-decoration:none;font-size:13px;font-weight:600;padding:8px 12px;border-radius:6px}
 nav a:hover{background:rgba(255,255,255,.08);color:#fff}
 nav a.on{background:#39c0ff;color:#04121f}
 header .who{margin-left:auto;font-size:12px;color:#9fb2c6}
 main{max-width:860px;margin:26px auto;padding:0 20px}
 .card{background:#fff;border:1px solid #dbe2ea;border-radius:10px;padding:20px 22px;margin-bottom:16px;
   box-shadow:0 1px 2px rgba(16,32,56,.05)}
 h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:0 0 10px}
 .muted{color:#66788c;font-size:13px}
 .pill{display:inline-block;background:#eef4fb;color:#2b6cb0;border:1px solid #cfe0f2;border-radius:999px;
   padding:2px 10px;font-size:11px;font-weight:700}
 label{display:block;font-size:12px;font-weight:700;color:#42546a;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px}
 input,textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:11px 12px;font:inherit;background:#fbfcfe}
 input:focus,textarea:focus{outline:none;border-color:#39c0ff;box-shadow:0 0 0 3px rgba(57,192,255,.2)}
 textarea{min-height:120px;resize:vertical}
 button,.btn{display:inline-block;background:#0f2038;color:#fff;border:0;border-radius:8px;padding:11px 18px;
   font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
 button:hover,.btn:hover{background:#183255}
 .btn.alt{background:#39c0ff;color:#04121f}
 .tkt{border:1px solid #e2e8f0;border-radius:9px;padding:14px 16px;margin-bottom:11px;background:#fbfdff}
 .tkt h3{margin:0 0 6px;font-size:15px} .tkt a{color:#2b6cb0;text-decoration:none;font-weight:700}
 .tkt .from{font-size:12px;color:#7688} .tkt .body{margin-top:8px}
 .list a{color:#2b6cb0;font-weight:700;text-decoration:none} .list li{margin:6px 0}
 .flag{font-family:ui-monospace,Consolas,monospace;background:#0f2038;color:#39ff9e;padding:14px;border-radius:8px;word-break:break-all}
 .warn{background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:8px;padding:11px 13px;font-size:13px}
 .ok{background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;border-radius:8px;padding:11px 13px}
 footer{max-width:860px;margin:10px auto 40px;padding:0 20px;color:#8a99ab;font-size:12px}
</style></head>
<body>
<header><div class="logo">Northwind <span>Support</span></div><nav>${nav}</nav>
  <div class="who">${esc(opts.who || '')}</div></header>
<main>${opts.body}</main>
<footer>Northwind Support Desk &middot; authorized lab use only</footer>
</body></html>`;
}

const custNav = a => ([
  { href: '/lab/', label: 'New Ticket', active: a === 'new' },
  { href: '/lab/status', label: 'My Tickets', active: a === 'status' },
  { href: '/lab/help', label: 'Help', active: a === 'help' }
]);
const agentNav = a => ([
  { href: '/lab/agent', label: 'Queue', active: a === 'queue' },
  { href: '/lab/agent/users', label: 'Agents', active: a === 'users' },
  { href: '/lab/agent/settings', label: 'Settings', active: a === 'settings' },
  { href: '/lab/agent/secrets', label: 'Vault', active: a === 'secrets' }
]);

// ---- customer side ------------------------------------------------------
router.get('/', (req, res) => {
  const sent = req.query.sent;
  res.type('html').send(page({
    title: 'Northwind Support — New Ticket', nav: custNav('new'), who: 'guest',
    body:
      (sent ? `<div class="card ok">Thanks — ticket <b>#${esc(sent)}</b> was queued. An agent will review it in the console shortly.</div>` : '') +
      `<div class="card">
        <h1>Open a support ticket</h1>
        <p class="muted">Describe your issue. Our agents review every ticket in the internal console.</p>
        <form method="post" action="/lab/submit">
          <label for="from">Your email</label>
          <input id="from" name="from" value="customer@example.com"/>
          <label for="subject">Subject</label>
          <input id="subject" name="subject" placeholder="Short summary"/>
          <label for="message">Message</label>
          <textarea id="message" name="message" placeholder="What went wrong?"></textarea>
          <div style="margin-top:14px"><button type="submit">Submit ticket</button></div>
        </form>
      </div>
      <div class="card muted">Are you an agent? Open the <a href="/lab/agent">Agent Console</a> to work the queue.</div>`
  }));
});

router.post('/submit', (req, res) => {
  const b = req.body || {};
  const id = addTicket({ subject: (b.subject || '(no subject)').slice(0, 300),
    message: (b.message || '').slice(0, 20000), from: (b.from || 'anonymous').slice(0, 200) });
  res.redirect('/lab/?sent=' + id);
});

router.get('/status', (req, res) => {
  res.type('html').send(page({ title: 'My Tickets', nav: custNav('status'), who: 'guest',
    body: `<div class="card"><h1>My Tickets</h1><p class="muted">Ticket status is only visible to Northwind agents in the internal console.</p></div>` }));
});
router.get('/help', (req, res) => {
  res.type('html').send(page({ title: 'Help', nav: custNav('help'), who: 'guest',
    body: `<div class="card"><h1>Help Center</h1><ul class="list"><li><a href="/lab/">Submit a new ticket</a></li><li><a href="/lab/status">Check my tickets</a></li></ul></div>` }));
});

// ---- agent side (the blind-XSS sink lives here) -------------------------
// Visiting the console establishes an agent session (HttpOnly cookie) and
// renders every ticket's subject + message as RAW HTML. That raw render is the
// intentional stored-XSS vulnerability.
router.get('/agent', (req, res) => {
  res.cookie(ADMIN_COOKIE, ADMIN_TOKEN, { httpOnly: true, sameSite: 'lax', path: '/lab' });
  const rows = tickets.map(t =>
    `<div class="tkt">
       <h3><a href="/lab/agent/tickets/${t.id}">#${t.id} · ${t.subject}</a></h3>
       <div class="from">from ${esc(t.from)} · ${when(t.at)}</div>
       <div class="body">${t.message}</div>
     </div>`).join('');   // <-- subject + message rendered RAW on purpose
  res.type('html').send(page({
    title: 'Agent Console — Queue', nav: agentNav('queue'), who: 'signed in as agent',
    body: `<div class="card"><h1>Review queue <span class="pill">${tickets.length} open</span></h1>
      <p class="muted">Agent console. Tickets render inline for fast triage.</p></div>
      ${rows || '<div class="card muted">No tickets yet.</div>'}`
  }));
});

router.get('/agent/tickets/:id', (req, res) => {
  const t = tickets.find(x => String(x.id) === String(req.params.id));
  if (!t) return res.status(404).type('html').send(page({ title: 'Not found', nav: agentNav('queue'), body: '<div class="card">Ticket not found. <a href="/lab/agent">Back to queue</a></div>' }));
  res.type('html').send(page({
    title: 'Ticket #' + t.id, nav: agentNav('queue'), who: 'signed in as agent',
    body: `<div class="card"><a href="/lab/agent">← queue</a>
      <h1 style="margin-top:8px">#${t.id} · ${t.subject}</h1>
      <div class="from muted">from ${esc(t.from)} · ${when(t.at)}</div>
      <div class="body" style="margin-top:12px">${t.message}</div></div>`   // raw again
  }));
});

router.get('/agent/users', (req, res) => {
  const agents = [['Dana Osei', 'd.osei', 'admin'], ['Priya Nair', 'p.nair', 'agent'], ['Tom Reyes', 't.reyes', 'agent']];
  res.type('html').send(page({
    title: 'Agents', nav: agentNav('users'), who: 'signed in as agent',
    body: `<div class="card"><h1>Agents</h1><ul class="list">${
      agents.map(a => `<li><a href="/lab/agent/tickets/1">${a[0]}</a> <span class="muted">@${a[1]} · ${a[2]}</span></li>`).join('')
    }</ul><p class="muted">Need elevated access? See the <a href="/lab/agent/secrets">credential vault</a>.</p></div>`
  }));
});

router.get('/agent/settings', (req, res) => {
  res.type('html').send(page({
    title: 'Settings', nav: agentNav('settings'), who: 'signed in as agent',
    body: `<div class="card"><h1>Console settings</h1><ul class="list">
      <li><a href="/lab/agent">Back to queue</a></li>
      <li><a href="/lab/agent/secrets">Credential vault</a> <span class="muted">(requires agent session)</span></li>
    </ul></div>`
  }));
});

// The payoff: only resolves when the request carries the agent session cookie,
// so it works when fetched THROUGH the hooked agent, not by the operator direct.
router.get('/agent/secrets', (req, res) => {
  const authed = cookies(req)[ADMIN_COOKIE] === ADMIN_TOKEN;
  if (!authed) {
    return res.status(403).type('html').send(page({
      title: 'Vault — 403', nav: agentNav('secrets'), who: 'not signed in',
      body: `<div class="card"><h1>403 · Agent session required</h1>
        <div class="warn">This page only loads inside an authenticated agent session. Open it through a hooked agent's browser (Page Mirror), not directly.</div></div>`
    }));
  }
  res.type('html').send(page({
    title: 'Credential Vault', nav: agentNav('secrets'), who: 'signed in as agent',
    body: `<div class="card"><h1>Credential Vault</h1>
      <p class="muted">Internal integration secrets. Visible only to an authenticated agent session.</p>
      <p><b>Payroll API key</b></p><div class="flag">${SECRET_FLAG}</div>
      <p style="margin-top:14px"><b>SMTP relay</b> <span class="muted">smtp://mailer:${ADMIN_TOKEN}@relay.northwind.example</span></p></div>`
  }));
});

module.exports = router;
