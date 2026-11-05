#!/usr/bin/env bash
# Runs as the dedicated deploy user on Ubuntu; sudo may only restart/stop this unit.
set -euo pipefail
revision=${1:?missing revision}
run_id=${2:?missing run id}
attempt=${3:?missing attempt}
port=${4:?missing application port}
[[ "$revision" =~ ^[0-9a-f]{40}$ && "$run_id" =~ ^[0-9]+$ && "$attempt" =~ ^[0-9]+$ && "$port" =~ ^[0-9]{1,5}$ ]]
(( port >= 1 && port <= 65535 ))
root=/srv/monopoly-club
archive="$root/incoming/$run_id-$attempt.tar.gz"
release="$root/releases/$revision-$run_id-$attempt"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment is running' >&2; exit 1; }
[[ -f "$archive" && ! -e "$release" ]]
if [[ -e "$root/current" && ! -L "$root/current" ]]; then
  echo 'Refusing to replace a non-symlink current path' >&2
  exit 1
fi
previous=$(readlink "$root/current" || true)
if [[ -n "$previous" && ( "$previous" != "$root/releases/"* || ! -f "$previous/server.js" ) ]]; then
  echo 'Refusing to replace an unexpected current release' >&2
  exit 1
fi
mkdir "$release"
tar -xzf "$archive" -C "$release" --no-same-owner --no-same-permissions
test -f "$release/server.js"
ln -s "$release" "$root/current.new.$run_id-$attempt"
mv -Tf "$root/current.new.$run_id-$attempt" "$root/current"
healthy() {
  for _ in {1..30}; do
    if systemctl is-active --quiet monopoly-club.service && page=$(curl -fsS --max-time 2 "http://127.0.0.1:$port/") && [[ "$page" == *MONOPOLY* ]]; then return 0; fi
    sleep 1
  done
  return 1
}
if sudo -n /usr/bin/systemctl restart monopoly-club.service && healthy; then
  rm -f -- "$archive"
  echo 'Release is healthy'
  exit 0
fi
echo 'New release failed; restoring previous release' >&2
if [[ -n "$previous" ]]; then
  ln -s "$previous" "$root/current.rollback.$run_id-$attempt"
  mv -Tf "$root/current.rollback.$run_id-$attempt" "$root/current"
  if ! sudo -n /usr/bin/systemctl restart monopoly-club.service || ! healthy; then
    echo 'Rollback failed health check; manual intervention is required' >&2
  fi
else
  sudo -n /usr/bin/systemctl stop monopoly-club.service || true
  rm -f -- "$root/current"
fi
exit 1
