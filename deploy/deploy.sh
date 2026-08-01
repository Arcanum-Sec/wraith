#!/usr/bin/env bash
# Deploy WRAITH to a host under systemd (bare-metal alternative to Docker).
# Run from the project root on your local machine.
#
#   WRAITH_VPS=root@YOUR_VPS_IP WRAITH_SSH_KEY=~/.ssh/your_key bash deploy/deploy.sh
#
# Overridable (no defaults for the target — you must point it at your own box):
#   WRAITH_VPS       e.g. root@203.0.113.10   (REQUIRED)
#   WRAITH_SSH_KEY   e.g. ~/.ssh/id_ed25519   (default: your ssh-agent / config)
#   WRAITH_DEST      default /opt/wraith
#   WRAITH_PUBLIC_URL  advertised URL, e.g. http://203.0.113.10:8090
set -euo pipefail

VPS="${WRAITH_VPS:-}"
DEST="${WRAITH_DEST:-/opt/wraith}"
PUBLIC_URL="${WRAITH_PUBLIC_URL:-}"
if [ -z "$VPS" ]; then
  echo "Set WRAITH_VPS to your server, e.g. WRAITH_VPS=root@YOUR_VPS_IP bash deploy/deploy.sh" >&2
  exit 1
fi
# Use the given key if provided; otherwise rely on ssh-agent / ~/.ssh/config.
SSH_OPTS=(); [ -n "${WRAITH_SSH_KEY:-}" ] && SSH_OPTS=(-i "$WRAITH_SSH_KEY")
# Default the advertised URL to the host part of $VPS on :8090 if unset.
[ -z "$PUBLIC_URL" ] && PUBLIC_URL="http://${VPS#*@}:8090"

echo "[*] Pushing source to $VPS:$DEST ..."
if command -v rsync >/dev/null 2>&1; then
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
    --exclude node_modules --exclude .git --exclude .claude \
    --exclude .env --exclude 'wraith.env' --exclude data \
    ./ "$VPS:$DEST/"
else
  ssh "${SSH_OPTS[@]}" "$VPS" "mkdir -p $DEST"
  scp "${SSH_OPTS[@]}" -r config.js server.js store.js lab.js package.json package-lock.json README.md \
    modules public deploy "$VPS:$DEST/"
fi

echo "[*] Installing deps + (re)starting the wraith service ..."
# Unquoted heredoc: $DEST/$PUBLIC_URL expand locally; \$VARS run on the host.
ssh "${SSH_OPTS[@]}" "$VPS" "bash -s" <<REMOTE
set -e
cd "$DEST"
command -v node >/dev/null || { echo 'Node.js 18+ is not installed on the host'; exit 1; }
npm install --omit=dev
if [ ! -f wraith.env ]; then
  PASS=\$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-22)
  SECRET=\$(openssl rand -hex 32)
  printf 'WRAITH_HOST=0.0.0.0\nWRAITH_PORT=8090\nWRAITH_PUBLIC_URL=%s\nWRAITH_OP_USER=operator\nWRAITH_OP_PASSWORD=%s\nWRAITH_SECRET=%s\nWRAITH_SESSION_HOURS=12\n' "$PUBLIC_URL" "\$PASS" "\$SECRET" > wraith.env
  echo "GENERATED_OPERATOR_PASSWORD=\$PASS"
  echo "GENERATED_OPERATOR_USER=operator"
fi
chmod 600 wraith.env
cp deploy/wraith.service /etc/systemd/system/wraith.service
systemctl daemon-reload
systemctl enable wraith
systemctl restart wraith
command -v ufw >/dev/null && ufw allow 8090 >/dev/null 2>&1 || true
sleep 1
systemctl --no-pager status wraith | head -6
REMOTE

echo
echo "[*] Save the GENERATED_OPERATOR_PASSWORD printed above (first deploy only)."
echo "[*] Operator console:  ${PUBLIC_URL}/operator/   (log in at /login)"
echo "[*] To rotate credentials later:"
echo "      ssh ${SSH_OPTS[*]} $VPS 'nano $DEST/wraith.env && systemctl restart wraith'"
