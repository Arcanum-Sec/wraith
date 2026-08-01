// WRAITH configuration. Environment-driven so the same build runs on localhost
// for a classroom demo and on a remote VPS / Docker lab with one env change.
//
//   Local (default):   npm start
//   Docker / VPS:       ./setup.sh   (writes .env, then docker compose up)
//
// hook.js does NOT read this file; it derives its call-back origin from where
// it was loaded, so the build is portable with zero code changes.

const crypto = require('crypto');

module.exports = {
  // Interface to bind. 127.0.0.1 = localhost only. 0.0.0.0 = network / VPS / container.
  host: process.env.WRAITH_HOST || '127.0.0.1',

  // HTTP + WebSocket port (same port, upgraded).
  port: parseInt(process.env.WRAITH_PORT || '3000', 10),

  // Public URL the framework should advertise for hooks (what victims reach).
  // Behind Docker/nginx the bind host is 0.0.0.0, which is useless in a payload,
  // so setup.sh writes the operator's real IP or domain here. It is used only to
  // PRINT correct URLs (startup banner + docs). Empty => derive from host:port.
  // The operator console always derives hook URLs from the browser's own origin,
  // so this never has to be perfect for the payload catalog to be correct.
  publicUrl: (process.env.WRAITH_PUBLIC_URL || '').replace(/\/+$/, ''),

  // Operator login username. Optional; when set, /login requires it alongside the
  // password. setup.sh always sets one for a deployed lab.
  operatorUser: process.env.WRAITH_OP_USER || '',

  // Operator login password. Gates the operator console (page + live channel).
  //   - empty  => login DISABLED (fine on localhost; the server REFUSES to bind
  //               to a public interface without one, so you can't expose an open panel).
  //   - set    => /operator requires logging in at /login first.
  operatorPassword: process.env.WRAITH_OP_PASSWORD || '',

  // HMAC secret used to sign the operator session cookie. Defaults to a random
  // per-boot value (sessions drop on restart). Set it to keep sessions across restarts.
  sessionSecret: process.env.WRAITH_SECRET || crypto.randomBytes(32).toString('hex'),

  // Operator session lifetime, hours.
  sessionHours: parseInt(process.env.WRAITH_SESSION_HOURS || '12', 10),

  // Blind-XSS mode: auto-fire the Page Capture task the instant a browser hooks,
  // so the loot (origin, cookies, DOM, screenshot) arrives with no operator click
  // -- exactly what XSS Hunter / ezXSS do when a payload fires somewhere nobody is
  // watching. Set WRAITH_AUTOCAPTURE=0 to force the BeEF-style manual "click to
  // capture" flow for a lecture that walks through deploying it by hand.
  autoCapture: process.env.WRAITH_AUTOCAPTURE !== '0'
};
