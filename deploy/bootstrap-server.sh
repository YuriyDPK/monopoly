#!/usr/bin/env bash
# Run once as root after checking the server. Pass the base64-encoded public
# deployment key and the chosen, verified-free TCP port as arguments.
set -euo pipefail
encoded_key=${1:?missing base64 public key}
port=${2:?missing port}
[[ $EUID -eq 0 && "$encoded_key" =~ ^[A-Za-z0-9+/=]+$ && "$port" =~ ^[0-9]{1,5}$ ]]
(( port >= 1 && port <= 65535 ))
public_key=$(printf '%s' "$encoded_key" | base64 -d)
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]]
for path in /srv/monopoly-club /opt/monopoly-club-node /var/lib/monopoly-deploy /etc/systemd/system/monopoly-club.service /etc/sudoers.d/monopoly-club; do
  if [[ -e "$path" || -L "$path" ]]; then echo "Path already exists: $path" >&2; exit 1; fi
done
if getent passwd monopoly-deploy >/dev/null || getent group monopoly-deploy >/dev/null; then echo 'Deployment account/group already exists' >&2; exit 1; fi
if [[ $(systemctl show -p LoadState --value monopoly-club.service) != not-found ]]; then echo 'Service name already exists' >&2; exit 1; fi
if [[ -n $(ss -H -lnt "sport = :$port") ]]; then echo "Port $port is occupied" >&2; exit 1; fi
for cmd in curl tar xz sha256sum sudo visudo flock ufw; do command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 1; }; done
[[ $(uname -m) == x86_64 ]] || { echo 'Unsupported server architecture' >&2; exit 1; }

# Install a separate Node.js runtime; leave the system node and other games alone.
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$temp/SHA256SUMS"
read -r checksum filename < <(awk '$2 ~ /^node-v24\.[0-9.]+-linux-x64\.tar\.xz$/ {print $1, $2; exit}' "$temp/SHA256SUMS")
[[ "$checksum" =~ ^[a-f0-9]{64}$ && "$filename" =~ ^node-v24\.[0-9.]+-linux-x64\.tar\.xz$ ]]
curl -fsSL --proto '=https' --tlsv1.2 "https://nodejs.org/dist/latest-v24.x/$filename" -o "$temp/$filename"
(cd "$temp" && printf '%s  %s\n' "$checksum" "$filename" | sha256sum -c -)
mkdir "$temp/node"
tar -xJf "$temp/$filename" -C "$temp/node" --strip-components=1 --no-same-owner
install -d -m 0755 /opt/monopoly-club-node
cp -a "$temp/node/." /opt/monopoly-club-node/

useradd --system --user-group --home-dir /var/lib/monopoly-deploy --create-home --shell /bin/bash monopoly-deploy
install -d -o monopoly-deploy -g monopoly-deploy -m 0700 /var/lib/monopoly-deploy/.ssh
printf 'restrict %s\n' "$public_key" > /var/lib/monopoly-deploy/.ssh/authorized_keys
chown monopoly-deploy:monopoly-deploy /var/lib/monopoly-deploy/.ssh/authorized_keys
chmod 0600 /var/lib/monopoly-deploy/.ssh/authorized_keys
install -d -o monopoly-deploy -g monopoly-deploy -m 0750 /srv/monopoly-club /srv/monopoly-club/releases /srv/monopoly-club/incoming
cat > /etc/systemd/system/monopoly-club.service <<UNIT
[Unit]
Description=Monopoly Club game
After=network.target

[Service]
Type=simple
User=monopoly-deploy
Group=monopoly-deploy
WorkingDirectory=/srv/monopoly-club/current
Environment=NODE_ENV=production
Environment=HOSTNAME=0.0.0.0
Environment=PORT=$port
ExecStart=/opt/monopoly-club-node/bin/node /srv/monopoly-club/current/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/monopoly-club
CapabilityBoundingSet=
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT
printf '%s\n' 'monopoly-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart monopoly-club.service, /usr/bin/systemctl stop monopoly-club.service' > "$temp/sudoers"
visudo -cf "$temp/sudoers"
install -o root -g root -m 0440 "$temp/sudoers" /etc/sudoers.d/monopoly-club
systemctl daemon-reload
systemctl enable monopoly-club.service
ufw allow "$port/tcp" comment 'Monopoly Club game'
echo "Monopoly Club setup complete on port $port"
