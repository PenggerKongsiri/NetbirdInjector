#!/usr/bin/env bash
set -Eeuo pipefail

APP="netbird-injector-manager"
ROOT="/opt/${APP}/current"
CONFIG="/etc/${APP}/config.json"

[[ "${EUID}" -eq 0 ]] || { printf 'error: run as root\n' >&2; exit 1; }
"${ROOT}/setup" status
"${ROOT}/setup" doctor
stat -c '%U:%G %a %n' "${CONFIG}" "/var/lib/${APP}" "/var/backups/${APP}"
if [[ -f "/etc/${APP}/netbird.token" ]]; then
  stat -c '%U:%G %a %n' "/etc/${APP}/netbird.token"
fi
printf 'post-install verification passed\n'
