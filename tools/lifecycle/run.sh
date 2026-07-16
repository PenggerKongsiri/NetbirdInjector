#!/usr/bin/env bash
set -Eeuo pipefail

APP="netbird-injector-manager"
WORKSPACE="/workspace"

assert_mode() { [[ "$(stat -c '%a' -- "$1")" == "$2" ]] || { printf 'unexpected mode for %s\n' "$1" >&2; exit 1; }; }
health_once() { node -e "fetch('http://127.0.0.1:9090/healthz',{signal:AbortSignal.timeout(1000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; }
health() {
  for _ in {1..30}; do health_once && return; sleep 0.2; done
  return 1
}

cd "${WORKSPACE}"
bash -n setup packaging/post-install-verify.sh packaging/collect-logs.sh tools/lifecycle/systemctl tools/lifecycle/run.sh
./setup detect
node scripts/release.mjs build
RELEASE="${WORKSPACE}/dist/release/netbird-injector-manager"
printf '%s\n' 'fake-lifecycle-admin-password' > /run/nim-admin-password
chmod 0600 /run/nim-admin-password
NIM_ADMIN_PASSWORD_FILE=/run/nim-admin-password "${RELEASE}/setup" install
initial_release="$(readlink -f -- "/opt/${APP}/current")"

id netbird-injector >/dev/null
[[ "$(stat -c '%U:%G' -- "/etc/${APP}/config.json")" == 'root:netbird-injector' ]]
assert_mode "/etc/${APP}/config.json" 640
assert_mode "/var/lib/${APP}" 750
assert_mode "/var/backups/${APP}" 750
[[ -f "/var/lib/${APP}/state.db" ]]
install -o root -g netbird-injector -m 0640 /dev/null "/etc/${APP}/netbird.token"
assert_mode "/etc/${APP}/netbird.token" 640
health

NIM_ADMIN_PASSWORD_FILE=/run/nim-admin-password "${RELEASE}/setup" install
NIM_ADMIN_USERNAME=recovered-admin NIM_ADMIN_PASSWORD_FILE=/run/nim-admin-password "${RELEASE}/setup" reset-admin
[[ "$(node -p 'require(process.argv[1]).admin.username' "/etc/${APP}/config.json")" == 'recovered-admin' ]]
node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);const a=db.prepare("SELECT username,totp_enabled FROM admin_account WHERE id=1").get();db.close();if(a.username!=="recovered-admin"||a.totp_enabled!==0)process.exit(1)' "/var/lib/${APP}/state.db"
health
printf '\n\n\n\n\n\n\n\n' | "${RELEASE}/setup" reconfigure
"${RELEASE}/setup" status
"${RELEASE}/setup" doctor
"/opt/${APP}/current/packaging/post-install-verify.sh"
"/opt/${APP}/current/packaging/collect-logs.sh" /tmp/nim-diagnostics.tar.gz
[[ -s /tmp/nim-diagnostics.tar.gz ]]

"${RELEASE}/setup" backup
backup_path="$(find "/var/backups/${APP}" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' | sort | tail -n 1)"
[[ -n "${backup_path}" ]]
"${RELEASE}/setup" restore "${backup_path}"

"${RELEASE}/setup" update
good_release="$(readlink -f -- "/opt/${APP}/current")"
[[ "${good_release}" != "${initial_release}" ]]

cp -a -- "${RELEASE}" /tmp/tampered-release
printf 'tamper\n' >> /tmp/tampered-release/README.md
if /tmp/tampered-release/setup update; then printf 'tampered update unexpectedly succeeded\n' >&2; exit 1; fi
[[ "$(readlink -f -- "/opt/${APP}/current")" == "${good_release}" ]]

cp -a -- "${WORKSPACE}" /tmp/broken-source
sed -i '1i throw new Error("intentional lifecycle update failure");' /tmp/broken-source/src/main.mjs
(cd /tmp/broken-source && rm -rf dist && node scripts/release.mjs build)
if /tmp/broken-source/dist/release/netbird-injector-manager/setup update; then printf 'broken update unexpectedly succeeded\n' >&2; exit 1; fi
[[ "$(readlink -f -- "/opt/${APP}/current")" == "${good_release}" ]]
health

"${good_release}/setup" rollback "${initial_release}"
[[ "$(readlink -f -- "/opt/${APP}/current")" == "${initial_release}" ]]
health
systemctl stop "${APP}.service"
if health_once; then printf 'health unexpectedly passed after stop\n' >&2; exit 1; fi
systemctl restart "${APP}.service"
health

"${initial_release}/setup" uninstall
[[ ! -e "/opt/${APP}" ]]
[[ -f "/etc/${APP}/config.json" && -f "/var/lib/${APP}/state.db" && -d "/var/backups/${APP}" ]]
NIM_ADMIN_PASSWORD_FILE=/run/nim-admin-password "${RELEASE}/setup" install
health
"${RELEASE}/setup" uninstall --purge-config --purge-data --purge-backups
[[ ! -e "/opt/${APP}" && ! -e "/etc/${APP}" && ! -e "/var/lib/${APP}" && ! -e "/var/backups/${APP}" ]]

printf '%s\n' '{"lifecycle":"pass","systemd":"mocked","reboot":"not-tested","preservation":"pass","failedUpdateRollback":"pass","adminReset":"pass"}'
