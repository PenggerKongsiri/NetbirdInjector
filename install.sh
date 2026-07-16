#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="PenggerKongsiri/NetbirdInjector"
BRANCH="main"
TEMP_ROOT=""

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: curl -fsSL https://raw.githubusercontent.com/PenggerKongsiri/NetbirdInjector/main/install.sh | bash

Downloads one immutable snapshot of the public repository, validates the archive
layout, prints its commit and SHA-256, and launches the guided Ubuntu/Debian
bootstrap. Bootstrap options are forwarded, for example:

  curl -fsSL https://raw.githubusercontent.com/PenggerKongsiri/NetbirdInjector/main/install.sh \
    | bash -s -- --netbird-management-url https://netbird.example.com

Run as a normal sudo-capable user. Do not prefix the command with sudo.
EOF
}

cleanup() {
  if [[ -n "${TEMP_ROOT}" && -d "${TEMP_ROOT}" ]]; then
    rm -rf -- "${TEMP_ROOT}"
  fi
}

curl_https() {
  curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --retry-delay 1 \
    --retry-connrefused --silent --show-error "$@"
}

validate_archive_list() {
  local list_file="$1" expected_prefix="$2" member relative
  [[ -s "${list_file}" ]] || die "the downloaded source archive was empty"
  while IFS= read -r member; do
    [[ "${member}" == "${expected_prefix}"* ]] || die "the source archive contained a path outside its expected top-level directory"
    [[ "${member}" != /* && "${member}" != *\\* ]] || die "the source archive contained an unsafe path"
    relative="${member#"${expected_prefix}"}"
    case "/${relative}/" in
      */../*) die "the source archive contained parent-directory traversal" ;;
    esac
  done < "${list_file}"
}

main() {
  local api_file archive list_file verbose_file commit prefix source archive_sha
  umask 077
  trap cleanup EXIT
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; exit 0; fi
  [[ "$(uname -s)" == "Linux" ]] || die "the remote installer supports Linux only"
  [[ -r /etc/os-release ]] || die "/etc/os-release is required"
  # shellcheck source=/dev/null
  . /etc/os-release
  case "${ID:-}" in ubuntu|debian) ;; *) die "only Ubuntu and Debian are supported" ;; esac
  command -v curl >/dev/null || die "curl is required to retrieve the installer"
  command -v find >/dev/null || die "find is required to validate and normalize the source snapshot"
  command -v tar >/dev/null || die "tar is required to unpack the source snapshot"
  command -v sha256sum >/dev/null || die "sha256sum is required to fingerprint the source snapshot"
  [[ -r /dev/tty && -w /dev/tty && -t 1 ]] || die "run this installer from an interactive terminal"

  TEMP_ROOT="$(mktemp -d -t nim-remote-install.XXXXXXXX)"
  api_file="${TEMP_ROOT}/commit.json"
  archive="${TEMP_ROOT}/source.tar.gz"
  list_file="${TEMP_ROOT}/archive.list"
  verbose_file="${TEMP_ROOT}/archive.verbose"

  say "Resolving ${REPOSITORY} ${BRANCH} to one immutable commit..."
  curl_https --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2022-11-28' \
    --output "${api_file}" "https://api.github.com/repos/${REPOSITORY}/commits/${BRANCH}" \
    || die "GitHub could not resolve the repository; it must be public before this command can be used"
  commit="$(sed -nE 's/^[[:space:]]*"sha":[[:space:]]*"([0-9a-f]{40})",?$/\1/p' "${api_file}" | sed -n '1p')"
  [[ "${commit}" =~ ^[0-9a-f]{40}$ ]] || die "GitHub returned an invalid commit identifier"

  say "Downloading source commit ${commit}..."
  curl_https --output "${archive}" "https://github.com/${REPOSITORY}/archive/${commit}.tar.gz"
  tar -tzf "${archive}" > "${list_file}" || die "the downloaded source archive was corrupt"
  tar -tvzf "${archive}" > "${verbose_file}" || die "the downloaded source archive could not be inspected"
  if awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { unsafe=1 } END { exit unsafe ? 0 : 1 }' "${verbose_file}"; then
    die "the source archive contained a link or unsupported entry type"
  fi
  prefix="NetbirdInjector-${commit}/"
  validate_archive_list "${list_file}" "${prefix}"
  archive_sha="$(sha256sum "${archive}" | awk '{print $1}')"
  [[ "${archive_sha}" =~ ^[0-9a-f]{64}$ ]] || die "the source archive SHA-256 could not be calculated"
  say "Source archive SHA-256: ${archive_sha}"

  tar -xzf "${archive}" --no-same-owner --no-same-permissions -C "${TEMP_ROOT}"
  source="${TEMP_ROOT}/${prefix%/}"
  [[ -f "${source}/bootstrap-ubuntu.sh" && -f "${source}/package-lock.json" && -f "${source}/AGENTS.md" ]] \
    || die "the source snapshot was incomplete"
  if find "${source}" -type l -print -quit | grep -q .; then
    die "the source snapshot contained a symbolic link"
  fi
  find "${source}" -type d -exec chmod 0755 {} +
  find "${source}" -type f -exec chmod 0644 {} +
  chmod 0755 "${source}/install.sh" "${source}/bootstrap-ubuntu.sh" "${source}/setup" "${source}"/packaging/*.sh

  say "Launching the checked-out guided bootstrap. Review its plan before approving changes."
  bash "${source}/bootstrap-ubuntu.sh" "$@" < /dev/tty
}

if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
