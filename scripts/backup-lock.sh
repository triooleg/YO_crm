#!/usr/bin/env bash
# Shared exclusive host lock. Agent passes its already-locked descriptor explicitly.
command -v flock >/dev/null || { echo 'flock is required' >&2; exit 1; }
if [[ -n "${BACKUP_LOCK_FD:-}" ]]; then
  [[ "$BACKUP_LOCK_FD" =~ ^[0-9]+$ && -e "/proc/$$/fd/$BACKUP_LOCK_FD" ]] || exit 2
  [[ "$(readlink -f "/proc/$$/fd/$BACKUP_LOCK_FD")" == "$(realpath --canonicalize-missing "${BACKUP_STORAGE_PATH:?}/.executor.lock")" ]] || { echo 'Inherited lock does not belong to storage root' >&2;exit 2; }
  flock --exclusive --nonblock "$BACKUP_LOCK_FD" || exit 2
else
  LOCK_PATH="${BACKUP_STORAGE_PATH:?}/.executor.lock"
  mkdir -p -- "$(dirname -- "$LOCK_PATH")"
  exec 9>"$LOCK_PATH"
  flock --exclusive --nonblock 9 || { echo 'Another backup/recovery operation holds the lock' >&2; exit 2; }
  export BACKUP_LOCK_FD=9
fi
