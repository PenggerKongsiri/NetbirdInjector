#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP="netbird-injector-manager"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
RELEASE_DIR="${SOURCE_DIR}/dist/release/netbird-injector-manager"
NODE_BASE_URL="https://nodejs.org/dist/latest-v24.x"
NETBIRD_KEY_URL="https://pkgs.netbird.io/debian/public.key"
NETBIRD_APT_URL="https://pkgs.netbird.io/debian"
ASSUME_YES=0
SKIP_NETBIRD_CONNECT=0
NETBIRD_MANAGEMENT_URL=""
NETBIRD_PREEXISTING=0
TEMP_ROOT=""

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./bootstrap-ubuntu.sh [OPTIONS]

Install the prerequisites, verify the project, build a manifest-checked release,
and launch the guided NetBird Injector Manager installer.

Options:
  --yes                         Skip only the initial plan confirmation.
  --skip-netbird-connect       Install a missing client but skip its enrollment.
  --netbird-management-url URL Use an HTTPS self-hosted NetBird management URL.
  -h, --help                    Show this help.

This script intentionally does not change NetBird policies, DNS, firewall rules,
reverse-proxy services, Coolify, Traefik, or application routes.
EOF
}

cleanup() {
  if [[ -n "${TEMP_ROOT}" && -d "${TEMP_ROOT}" ]]; then
    rm -rf -- "${TEMP_ROOT}"
  fi
}
trap cleanup EXIT

parse_args() {
  while (($#)); do
    case "$1" in
      --yes) ASSUME_YES=1 ;;
      --skip-netbird-connect) SKIP_NETBIRD_CONNECT=1 ;;
      --netbird-management-url)
        (($# >= 2)) || die "--netbird-management-url requires a value"
        NETBIRD_MANAGEMENT_URL="$2"
        shift
        ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $1" ;;
    esac
    shift
  done

  if [[ -n "${NETBIRD_MANAGEMENT_URL}" && ! "${NETBIRD_MANAGEMENT_URL}" =~ ^https://[^[:space:]]+$ ]]; then
    die "the NetBird management URL must be an HTTPS URL"
  fi
}

as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo -- "$@"
  fi
}

confirm() {
  local prompt="$1" default_answer="${2:-no}" answer
  if [[ "${default_answer}" == "yes" ]]; then
    read -r -p "${prompt} [Y/n] " answer
    [[ -z "${answer}" || "${answer}" =~ ^[Yy]$ ]]
  else
    read -r -p "${prompt} [y/N] " answer
    [[ "${answer}" =~ ^[Yy]$ ]]
  fi
}

make_temp_root() {
  if [[ -z "${TEMP_ROOT}" ]]; then
    TEMP_ROOT="$(mktemp -d -t nim-bootstrap.XXXXXXXX)"
  fi
}

validate_source() {
  for path in package.json package-lock.json setup scripts/release.mjs; do
    [[ -f "${SOURCE_DIR}/${path}" ]] || die "run this script from a complete NetBird Injector Manager checkout or release"
  done
}

validate_platform() {
  [[ "$(uname -s)" == "Linux" ]] || die "this bootstrap supports Linux only"
  [[ -r /etc/os-release ]] || die "/etc/os-release is required"
  # shellcheck source=/dev/null
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) die "this bootstrap supports Ubuntu or Debian systemd hosts; detected ${ID:-unknown}" ;;
  esac
  command -v apt-get >/dev/null || die "apt-get is required"
  command -v systemctl >/dev/null || die "a booted systemd host is required"
  [[ -d /run/systemd/system ]] || die "a booted systemd host is required"
  case "$(uname -m)" in
    x86_64|amd64|aarch64|arm64) ;;
    *) die "only Linux x86_64 and arm64 are supported by this bootstrap" ;;
  esac
  if [[ "${EUID}" -ne 0 ]]; then
    command -v sudo >/dev/null || die "run as root or install sudo for a sudo-capable administrator"
    sudo -v
  fi
}

show_plan() {
  say ""
  say "NetBird Injector Manager guided bootstrap"
  say "  1. Install ca-certificates, curl, git, GnuPG, OpenSSL, and xz support with apt."
  say "  2. Keep a compatible Node.js 24, or install the official archive after SHA-256 verification."
  say "  3. Keep an existing NetBird installation unchanged; otherwise install it and guide enrollment."
  say "  4. Restore locked npm dependencies, run checks/audit, and build a verified release."
  say "  5. Launch the existing installer, which asks for the admin account and access mode."
  say ""
  say "Not changed: NetBird policies, DNS, firewall, reverse-proxy services, Coolify, Traefik, and routes."
  say ""
}

install_base_packages() {
  say "Installing base operating-system prerequisites..."
  as_root apt-get update
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gnupg openssl xz-utils
}

node_is_compatible() {
  command -v node >/dev/null 2>&1 \
    && node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major===24&&minor>=15?0:1)' >/dev/null 2>&1
}

normalize_node_permissions() {
  local target="$1"
  as_root chmod -R a+rX,go-w -- "${target}"
}

node_target_exists() {
  local target="$1"
  as_root test -e "${target}" || return 1
  if ! as_root test -d "${target}" || as_root test -L "${target}"; then
    die "${target} exists but is not a real directory; refusing to modify it"
  fi
}

install_node() {
  local machine node_arch checksums filename expected archive extract_dir directory target installed_version actual_version name link
  if node_is_compatible && command -v npm >/dev/null 2>&1; then
    say "Using compatible Node.js $(node --version) from $(command -v node)."
    return
  fi

  machine="$(uname -m)"
  case "${machine}" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) die "no official Node.js archive mapping exists for ${machine}" ;;
  esac

  make_temp_root
  checksums="${TEMP_ROOT}/SHASUMS256.txt"
  say "Downloading the official Node.js 24 checksum list..."
  curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    --output "${checksums}" "${NODE_BASE_URL}/SHASUMS256.txt"
  filename="$(awk -v arch="${node_arch}" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") { print $2 }' "${checksums}")"
  [[ "${filename}" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-${node_arch}\.tar\.xz$ ]] \
    || die "the official checksum list did not contain one expected Linux ${node_arch} archive"
  expected="$(awk -v file="${filename}" '$2 == file { print $1 }' "${checksums}")"
  [[ "${expected}" =~ ^[0-9a-f]{64}$ ]] || die "the Node.js checksum entry was invalid"

  archive="${TEMP_ROOT}/${filename}"
  say "Downloading ${filename}..."
  curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    --output "${archive}" "${NODE_BASE_URL}/${filename}"
  printf '%s  %s\n' "${expected}" "${archive}" | sha256sum --check --status - \
    || die "Node.js archive checksum verification failed"
  say "Node.js archive SHA-256 verification passed."

  extract_dir="${TEMP_ROOT}/node-extract"
  mkdir -m 0700 "${extract_dir}"
  tar -xJf "${archive}" -C "${extract_dir}"
  directory="${filename%.tar.xz}"
  [[ -x "${extract_dir}/${directory}/bin/node" ]] || die "the verified Node.js archive had an unexpected layout"
  target="/usr/local/lib/nodejs/${directory}"
  installed_version="${directory#node-v}"
  installed_version="${installed_version%%-*}"

  if ! node_target_exists "${target}"; then
    as_root install -d -o root -g root -m 0755 /usr/local/lib/nodejs
    as_root cp -a -- "${extract_dir}/${directory}" "${target}"
    as_root chown -R root:root "${target}"
  fi
  actual_version="$(as_root "${target}/bin/node" -p 'process.versions.node' 2>/dev/null || true)"
  [[ "${actual_version}" == "${installed_version}" ]] \
    || die "${target} exists but cannot run as the verified Node.js ${installed_version} installation"
  normalize_node_permissions "${target}"

  for name in node npm npx corepack; do
    link="/usr/local/bin/${name}"
    if as_root test -e "${link}" && ! as_root test -L "${link}"; then
      die "${link} is not a symlink; refusing to overwrite it"
    fi
    as_root ln -sfn -- "${target}/bin/${name}" "${link}"
  done
  export PATH="/usr/local/bin:${PATH}"
  hash -r
  /usr/local/bin/node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major===24&&minor>=15?0:1)' \
    || die "the installed Node.js version is not compatible"
  /usr/local/bin/npm --version >/dev/null || die "npm was not installed with Node.js"
  say "Installed Node.js $(/usr/local/bin/node --version) at ${target}."
}

install_netbird() {
  local public_key keyring source_list
  if command -v netbird >/dev/null 2>&1; then
    NETBIRD_PREEXISTING=1
    say "Using existing NetBird client at $(command -v netbird)."
    say "Leaving its package, service, management URL, and enrollment unchanged."
    return
  fi

  make_temp_root
  public_key="${TEMP_ROOT}/netbird-public.key"
  keyring="${TEMP_ROOT}/netbird-archive-keyring.gpg"
  source_list="${TEMP_ROOT}/netbird.list"
  say "Installing the NetBird client from its signed apt repository..."
  curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    --output "${public_key}" "${NETBIRD_KEY_URL}"
  gpg --batch --yes --dearmor --output "${keyring}" "${public_key}"
  printf 'deb [signed-by=/usr/share/keyrings/netbird-archive-keyring.gpg] %s stable main\n' "${NETBIRD_APT_URL}" > "${source_list}"
  as_root install -o root -g root -m 0644 "${keyring}" /usr/share/keyrings/netbird-archive-keyring.gpg
  as_root install -o root -g root -m 0644 "${source_list}" /etc/apt/sources.list.d/netbird.list
  as_root apt-get update
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y netbird
  as_root systemctl enable --now netbird.service
}

netbird_is_connected() {
  local status
  status="$(as_root netbird status --json 2>/dev/null)" || return 1
  NETBIRD_STATUS_JSON="${status}" node -e '
    try {
      const value = JSON.parse(process.env.NETBIRD_STATUS_JSON);
      process.exit((value.management?.connected ?? value.management?.Connected) === true ? 0 : 1);
    } catch { process.exit(1); }
  '
}

guide_netbird_connection() {
  local entered_url=""; local -a up_args=()
  if [[ "${NETBIRD_PREEXISTING}" -eq 1 ]]; then
    say "Skipping NetBird service and enrollment setup because the client was already installed."
    return
  fi
  if netbird_is_connected; then
    say "NetBird is already connected."
    return
  fi
  if [[ "${SKIP_NETBIRD_CONNECT}" -eq 1 ]]; then
    warn "NetBird enrollment was skipped; the Injector will not carry traffic until this peer is connected and permitted by policy."
    return
  fi

  if [[ -z "${NETBIRD_MANAGEMENT_URL}" ]]; then
    read -r -p "Self-hosted NetBird management URL (leave blank for NetBird Cloud): " entered_url
    NETBIRD_MANAGEMENT_URL="${entered_url}"
    if [[ -n "${NETBIRD_MANAGEMENT_URL}" && ! "${NETBIRD_MANAGEMENT_URL}" =~ ^https://[^[:space:]]+$ ]]; then
      die "the NetBird management URL must be an HTTPS URL"
    fi
  fi
  [[ -z "${NETBIRD_MANAGEMENT_URL}" ]] || up_args+=(--management-url "${NETBIRD_MANAGEMENT_URL}")

  say "NetBird will now print the browser/device authorization instructions for this VM."
  if ! as_root netbird up "${up_args[@]}"; then
    warn "NetBird enrollment did not complete."
  fi
  if netbird_is_connected; then
    say "NetBird connection verified."
    return
  fi
  warn "NetBird is still not connected. You can enroll it later with the command supplied by your NetBird dashboard."
  confirm "Continue with the Injector installation before NetBird is connected?" no \
    || die "stopped before application installation; rerun after NetBird enrollment or use --skip-netbird-connect"
}

run_project_checks() {
  if [[ -e "${SOURCE_DIR}/.git" ]]; then
    say "Running repository checks, full Git-history audit, and tests..."
    npm run check
  else
    say "Git metadata is not included in this immutable source archive."
    say "Running syntax/configuration checks, current-tree audit, and all tests; full history remains enforced in CI and Git checkouts."
    npm run check:source-archive
  fi
}

build_and_install() {
  local lifecycle_command="install"
  cd "${SOURCE_DIR}"
  say "Restoring exact npm dependencies from package-lock.json..."
  npm ci --ignore-scripts
  run_project_checks
  say "Checking installed dependencies for high/critical known vulnerabilities..."
  npm audit --audit-level=high
  say "Building and verifying the release bundle..."
  npm run release:build
  node scripts/release.mjs verify "${RELEASE_DIR}"

  as_root bash "${RELEASE_DIR}/setup" detect
  if as_root test -L "/opt/${APP}/current" && as_root test -f "/etc/${APP}/config.json"; then
    lifecycle_command="update"
    say "An existing installation was detected; using the backup-and-health-gated update flow."
  else
    say "Launching the guided installer. It will ask for the administrator account and admin access mode."
  fi
  as_root bash "${RELEASE_DIR}/setup" "${lifecycle_command}"
}

finish_message() {
  say ""
  say "Bootstrap completed successfully."
  say "Next: create a narrow NetBird policy, point one test reverse-proxy hostname at this Injector peer,"
  say "and configure the matching exact-host route in the admin UI. Do not replace a working route yet."
  say "Read docs/NETBIRD_SETUP.md and docs/PRODUCTION_CHECKLIST.md before exposing traffic."
}

main() {
  parse_args "$@"
  validate_source
  [[ -t 0 && -t 1 ]] || die "the guided bootstrap requires an interactive terminal"
  validate_platform
  show_plan
  if [[ "${ASSUME_YES}" -ne 1 ]]; then
    confirm "Proceed with prerequisite and application installation?" no || die "installation cancelled"
  fi
  install_base_packages
  install_node
  install_netbird
  guide_netbird_connection
  build_and_install
  finish_message
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
