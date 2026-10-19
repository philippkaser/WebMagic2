#!/usr/bin/env sh
# Install WebMagic as a systemd service on a Linux server: it builds the
# client, then runs the game server in the background — it keeps running
# after you log out, starts again when the machine boots, and restarts
# itself if it ever crashes. Run it from the repo, as root (or with sudo):
#
#   sh scripts/install-service.sh            # serves on port 80
#   PORT=8080 sh scripts/install-service.sh  # or another port
#
# Afterwards:
#   systemctl status webmagic       is it running?
#   journalctl -u webmagic -f       its log, live (Ctrl+C to stop watching)
#   systemctl restart webmagic      after an update (see README: On a server)
#   systemctl stop webmagic         stop it (saves are flushed first)
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUN="$(command -v bun || true)"
PORT="${PORT:-80}"

if [ -z "$BUN" ]; then
  echo "bun isn't on PATH — install it first: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "run this as root (or with sudo): it writes /etc/systemd/system/webmagic.service" >&2
  exit 1
fi

echo "building the client in $DIR …"
cd "$DIR"
"$BUN" install
"$BUN" run build

cat > /etc/systemd/system/webmagic.service <<UNIT
[Unit]
Description=WebMagic game server
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$BUN server/server.ts
Environment=PORT=$PORT
Restart=always
RestartSec=2
# The server writes pending saves on SIGTERM; give it a moment.
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable webmagic
systemctl restart webmagic
sleep 1
systemctl --no-pager --lines=5 status webmagic || true
echo
echo "WebMagic is running on port $PORT and will survive logouts and reboots."
echo "Live log: journalctl -u webmagic -f"
