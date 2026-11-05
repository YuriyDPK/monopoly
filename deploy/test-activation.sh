#!/usr/bin/env bash
# Exercise the real activation script with isolated files and fake service commands.
set -euo pipefail
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
mkdir -p "$temp/app/incoming" "$temp/app/releases" "$temp/bin" "$temp/package"
export TEST_ROOT="$temp/app" TEST_CALLS="$temp/calls"
printf 'console.log("test release")\n' > "$temp/package/server.js"
tar -czf "$temp/app/incoming/1-1.tar.gz" -C "$temp/package" .
tar -czf "$temp/app/incoming/2-1.tar.gz" -C "$temp/package" .
sed "s|^root=/srv/monopoly-club$|root=$temp/app|" deploy/activate-release.sh > "$temp/activate.sh"
cat > "$temp/bin/sudo" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_CALLS"
STUB
cat > "$temp/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$temp/bin/curl" <<'STUB'
#!/usr/bin/env bash
if [[ $(readlink "$TEST_ROOT/current") == */bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-* ]]; then exit 1; fi
printf 'MONOPOLY'
STUB
cat > "$temp/bin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$temp/bin/"*
export PATH="$temp/bin:$PATH"
good=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
bad=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
bash "$temp/activate.sh" "$good" 1 1 3002
[[ $(readlink "$TEST_ROOT/current") == "$TEST_ROOT/releases/$good-1-1" ]]
if bash "$temp/activate.sh" "$bad" 2 1 3002; then
  echo 'Unhealthy release was unexpectedly accepted' >&2
  exit 1
fi
[[ $(readlink "$TEST_ROOT/current") == "$TEST_ROOT/releases/$good-1-1" ]]
[[ $(wc -l < "$TEST_CALLS") -eq 3 ]]
echo 'Activation and rollback test passed'
