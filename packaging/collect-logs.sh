#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP="netbird-injector-manager"
ROOT="/opt/${APP}/current"
OUTPUT="${1:-./${APP}-diagnostics-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}"
WORK="$(mktemp -d -t "${APP}.diagnostics.XXXXXX")"
trap 'rm -rf -- "${WORK}"' EXIT

[[ "${EUID}" -eq 0 ]] || { printf 'error: run as root\n' >&2; exit 1; }
"${ROOT}/setup" doctor > "${WORK}/doctor.json" || true
systemctl show "${APP}.service" --no-pager \
  --property=ActiveState,SubState,MainPID,ExecMainStatus,NRestarts,MemoryCurrent,CPUUsageNSec > "${WORK}/service.txt" || true
if command -v journalctl >/dev/null; then
  journalctl -u "${APP}.service" --since '24 hours ago' --no-pager -o short-iso > "${WORK}/journal.txt" || true
else
  printf 'journalctl unavailable in this environment\n' > "${WORK}/journal.txt"
fi
stat -c '%U:%G %a %n' "/etc/${APP}" "/var/lib/${APP}" "/var/backups/${APP}" > "${WORK}/permissions.txt" || true
tar -C "${WORK}" -czf "${OUTPUT}" .
printf '%s\n' "${OUTPUT}"
