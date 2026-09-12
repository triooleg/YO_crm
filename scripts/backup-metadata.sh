#!/usr/bin/env bash

resolve_backup_git_commit() {
  local root="${1:-.}"
  local candidate=""
  local git_root=""
  local physical_root=""
  local release_commit=""
  local deployed_commit=""

  physical_root="$(cd -- "$root" 2>/dev/null && pwd -P || true)"
  git_root="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$git_root" ]]; then
    git_root="$(cd -- "$git_root" 2>/dev/null && pwd -P || true)"
  fi
  if [[ -n "$physical_root" && "$git_root" == "$physical_root" ]]; then
    candidate="$(git -C "$root" rev-parse HEAD 2>/dev/null || true)"
    candidate="${candidate//$'\r'/}"
    candidate="${candidate//$'\n'/}"
    if [[ "$candidate" =~ ^[a-f0-9]{40}$ ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  if [[ -f "$root/.release-commit" ]]; then
    release_commit="$(<"$root/.release-commit")"
    release_commit="${release_commit//$'\r'/}"
    [[ "$release_commit" =~ ^[a-f0-9]{40}$ ]] || release_commit=""
  fi
  if [[ -f "$root/.deployed-commit" ]]; then
    deployed_commit="$(<"$root/.deployed-commit")"
    deployed_commit="${deployed_commit//$'\r'/}"
    [[ "$deployed_commit" =~ ^[a-f0-9]{40}$ ]] || deployed_commit=""
  fi

  if [[ -n "$release_commit" && -n "$deployed_commit" && "$release_commit" != "$deployed_commit" ]]; then
    printf '%s\n' unknown
    return 0
  fi
  candidate="${release_commit:-$deployed_commit}"
  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  printf '%s\n' unknown
}
