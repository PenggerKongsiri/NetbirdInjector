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
bash -n setup install.sh bootstrap-ubuntu.sh packaging/post-install-verify.sh packaging/collect-logs.sh tools/lifecycle/systemctl tools/lifecycle/run.sh
./install.sh --help >/dev/null
bash -s -- --help < ./install.sh >/dev/null
source ./install.sh
printf '%s\n' 'NetbirdInjector-0123456789012345678901234567890123456789/' 'NetbirdInjector-0123456789012345678901234567890123456789/README.md' > /tmp/safe-archive.list
validate_archive_list /tmp/safe-archive.list 'NetbirdInjector-0123456789012345678901234567890123456789/'
printf '%s\n' 'NetbirdInjector-0123456789012345678901234567890123456789/../escape' > /tmp/unsafe-archive.list
if (validate_archive_list /tmp/unsafe-archive.list 'NetbirdInjector-0123456789012345678901234567890123456789/') 2>/dev/null; then
  printf 'remote installer unexpectedly accepted archive traversal\n' >&2
  exit 1
fi
./bootstrap-ubuntu.sh --help >/dev/null
mkdir -p /tmp/archive-source /tmp/checkout-source
(
  : > /tmp/archive-check.calls
  # shellcheck source=/dev/null
  source ./bootstrap-ubuntu.sh
  SOURCE_DIR=/tmp/archive-source
  export SOURCE_DIR
  # Invoked indirectly by run_project_checks from the sourced bootstrap.
  # shellcheck disable=SC2317,SC2329
  npm() { printf '%s\n' "$*" >> /tmp/archive-check.calls; }
  run_project_checks
) > /tmp/archive-check.log
grep -Fx 'run check:source-archive' /tmp/archive-check.calls >/dev/null
grep -F 'full history remains enforced in CI and Git checkouts' /tmp/archive-check.log >/dev/null
touch /tmp/checkout-source/.git
(
  : > /tmp/checkout-check.calls
  # shellcheck source=/dev/null
  source ./bootstrap-ubuntu.sh
  SOURCE_DIR=/tmp/checkout-source
  export SOURCE_DIR
  # Invoked indirectly by run_project_checks from the sourced bootstrap.
  # shellcheck disable=SC2317,SC2329
  npm() { printf '%s\n' "$*" >> /tmp/checkout-check.calls; }
  run_project_checks
) > /tmp/checkout-check.log
grep -Fx 'run check' /tmp/checkout-check.calls >/dev/null
grep -F 'full Git-history audit' /tmp/checkout-check.log >/dev/null
if node scripts/history-audit.mjs >/tmp/missing-history.log 2>&1; then
  printf 'history audit unexpectedly passed without Git metadata\n' >&2
  exit 1
fi
grep -E 'git is unavailable|not a git repository' /tmp/missing-history.log >/dev/null
npm run check:source-archive >/tmp/source-archive-check.log
grep -F 'repository text files passed secret and machine-path scanning' /tmp/source-archive-check.log >/dev/null
mkdir -p /tmp/restricted-node/bin /tmp/restricted-node/lib
printf '%s\n' '#!/usr/bin/env sh' 'exit 0' > /tmp/restricted-node/bin/node
printf '%s\n' 'module.exports = {};' > /tmp/restricted-node/lib/runtime.js
chmod 0700 /tmp/restricted-node /tmp/restricted-node/bin /tmp/restricted-node/lib /tmp/restricted-node/bin/node
chmod 0600 /tmp/restricted-node/lib/runtime.js
(
  # shellcheck source=/dev/null
  source ./bootstrap-ubuntu.sh
  normalize_node_permissions /tmp/restricted-node
)
assert_mode /tmp/restricted-node 755
assert_mode /tmp/restricted-node/bin 755
assert_mode /tmp/restricted-node/bin/node 755
assert_mode /tmp/restricted-node/lib/runtime.js 644
ln -s /tmp/restricted-node /tmp/restricted-node-link
if (
  # shellcheck source=/dev/null
  source ./bootstrap-ubuntu.sh
  node_target_exists /tmp/restricted-node-link
) >/tmp/restricted-node-link.log 2>&1; then
  printf 'bootstrap unexpectedly accepted a symlinked Node installation target\n' >&2
  exit 1
fi
grep -F 'is not a real directory; refusing to modify it' /tmp/restricted-node-link.log >/dev/null
mkdir -p /tmp/existing-netbird-bin
# The variables belong to the generated fake and must expand only when that fake runs.
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\n" "$*" >> "${NETBIRD_CALL_LOG:?}"' > /tmp/existing-netbird-bin/netbird
chmod 0755 /tmp/existing-netbird-bin/netbird
(
  export PATH="/tmp/existing-netbird-bin:${PATH}"
  export NETBIRD_CALL_LOG=/tmp/existing-netbird.calls
  : > "${NETBIRD_CALL_LOG}"
  # shellcheck source=/dev/null
  source ./bootstrap-ubuntu.sh
  install_netbird
  guide_netbird_connection
  [[ "${NETBIRD_PREEXISTING}" -eq 1 ]]
  [[ ! -s "${NETBIRD_CALL_LOG}" ]]
) > /tmp/existing-netbird.log
grep -F 'Leaving its package, service, management URL, and enrollment unchanged.' /tmp/existing-netbird.log >/dev/null
grep -F 'Skipping NetBird service and enrollment setup because the client was already installed.' /tmp/existing-netbird.log >/dev/null
if ./bootstrap-ubuntu.sh --not-a-real-option >/tmp/bootstrap-invalid.log 2>&1; then
  printf 'bootstrap unexpectedly accepted an unknown option\n' >&2
  exit 1
fi
grep -F 'unknown option' /tmp/bootstrap-invalid.log >/dev/null
if ./bootstrap-ubuntu.sh --netbird-management-url http://insecure.example --yes >/tmp/bootstrap-url.log 2>&1; then
  printf 'bootstrap unexpectedly accepted an insecure management URL\n' >&2
  exit 1
fi
grep -F 'must be an HTTPS URL' /tmp/bootstrap-url.log >/dev/null
./setup detect
node scripts/release.mjs build
RELEASE="${WORKSPACE}/dist/release/netbird-injector-manager"
for executable in setup install.sh bootstrap-ubuntu.sh packaging/collect-logs.sh packaging/post-install-verify.sh; do
  assert_mode "${RELEASE}/${executable}" 755
done
printf '%s\n' 'fake-lifecycle-admin-password' > /run/nim-admin-password
chmod 0600 /run/nim-admin-password
NIM_ADMIN_PASSWORD_FILE=/run/nim-admin-password "${RELEASE}/setup" install
initial_release="$(readlink -f -- "/opt/${APP}/current")"
for executable in setup install.sh bootstrap-ubuntu.sh packaging/collect-logs.sh packaging/post-install-verify.sh; do
  assert_mode "${initial_release}/${executable}" 755
done

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
