"""Pull existing YO CRM archives. Python 3 stdlib; never creates server backups."""
import argparse
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid

DEFAULT_ORIGIN = "https://crm.yoleotard.com"
DEFAULT_FOLDER = "D:\\YO_CRM_Backups"
RESERVE_BYTES = 256 * 1024 * 1024
CHUNK = 1024 * 1024
MAX_JSON = 2 * CHUNK


class SyncError(Exception):
    """Only fixed, credential-free messages may reach the operator."""


def validate_origin(value):
    parts = urllib.parse.urlsplit(value)
    if (parts.scheme != "https" or not parts.hostname or parts.username or parts.password
            or parts.path not in ("", "/") or parts.query or parts.fragment
            or any(c.isspace() for c in value)):
        raise SyncError("Invalid HTTPS origin")
    # Accessing port also rejects malformed ports.
    parts.port
    return value.rstrip("/")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SyncError("Redirect refused")

    def http_error_302(self, req, fp, code, msg, headers):
        raise SyncError("Redirect refused")

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def network_opener():
    return urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context()), NoRedirect()).open


def dpapi(data, decrypt=False):
    """Windows CurrentUser only; no CRYPTPROTECT_LOCAL_MACHINE, no UI."""
    if os.name != "nt":
        raise SyncError("Windows DPAPI required")

    class Blob(ctypes.Structure):
        _fields_ = [("length", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    try:
        if not function(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
            raise SyncError("DPAPI operation failed")
        return ctypes.string_at(outgoing.data, outgoing.length)
    finally:
        ctypes.memset(buffer, 0, len(data))
        if outgoing.data:
            ctypes.memset(outgoing.data, 0, outgoing.length)
            kernel.LocalFree(outgoing.data)


def atomic_write(path, data):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    owned = False
    try:
        with temporary.open("xb") as stream:
            owned = True
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if owned:
            temporary.unlink(missing_ok=True)


def save_config(path, config, protect=dpapi):
    validate_origin(config["origin"])
    token = config["token"]
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._~+/=-]{1,8192}", token):
        raise SyncError("Invalid pairing token")
    atomic_write(path, protect(json.dumps(config, ensure_ascii=False).encode("utf-8")))


def load_config(path, unprotect=None):
    unprotect = unprotect or (lambda data: dpapi(data, decrypt=True))
    return json.loads(unprotect(path.read_bytes()).decode("utf-8"))


def read_json(stream):
    data = stream.read(MAX_JSON + 1)
    if len(data) > MAX_JSON:
        raise SyncError("Response too large")
    return json.loads(data)


def checksum(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def archive_info(archive):
    archive_id = archive["id"]
    digest = archive["archiveChecksum"]
    size = archive["archiveBytes"]
    # Prisma BigInt is serialized as a decimal string by the existing API.
    if isinstance(size, str) and re.fullmatch(r"[1-9][0-9]{0,19}", size):
        size = int(size)
    if (not isinstance(archive_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{7,127}", archive_id)
            or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest)
            or type(size) is not int or size < 1):
        raise SyncError("Invalid archive metadata")
    return archive_id, digest.lower(), size


@lru_cache(maxsize=1)
def current_user_sid():
    system32 = Path(os.environ["SystemRoot"]) / "System32"
    output = subprocess.check_output([str(system32 / "whoami.exe"), "/user", "/fo", "csv", "/nh"],
                                     creationflags=subprocess.CREATE_NO_WINDOW, stderr=subprocess.DEVNULL)
    sid = output.rsplit(b",", 1)[-1].strip(b'"\r\n ' ).decode("ascii")
    if not re.fullmatch(r"S-1-5-(?:[0-9]+-)*[0-9]+", sid):
        raise SyncError("Cannot identify Windows user")
    return sid


def protect_archive(path):
    """Only a newly-created, still-empty partial; never touch directory/old files."""
    if os.name != "nt":
        raise SyncError("Windows archive ACL required")
    icacls = Path(os.environ["SystemRoot"]) / "System32" / "icacls.exe"
    subprocess.run([str(icacls), str(path), "/inheritance:r", "/grant:r",
                    "*" + current_user_sid() + ":(F)", "*S-1-5-18:(F)"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   creationflags=subprocess.CREATE_NO_WINDOW)


def download(archive, folder, request, opener, free_space, secure_file):
    archive_id, digest, size = archive_info(archive)
    target = folder / ("YO_CRM_" + archive_id + ".tar.gz")
    if target.is_symlink():
        raise SyncError("Destination link refused")
    if target.exists():
        if checksum(target) == (digest, size):
            return
        raise SyncError("Existing archive conflict")
    if free_space(folder).free < size + RESERVE_BYTES:
        raise SyncError("Insufficient free space")
    partial = target.with_name(target.name + "." + uuid.uuid4().hex + ".partial")
    # A crash orphan cannot block the next attempt; exclusively own this UUID only.
    owned = False
    try:
        with partial.open("xb") as output:
            owned = True
            secure_file(partial)
            actual = hashlib.sha256()
            received = 0
            with opener(request, timeout=60) as source:
                while True:
                    chunk = source.read(min(CHUNK, size - received + 1))
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > size or free_space(folder).free < len(chunk) + RESERVE_BYTES:
                        raise SyncError("Archive size or disk reserve exceeded")
                    output.write(chunk)
                    actual.update(chunk)
            output.flush()
            os.fsync(output.fileno())
        if received != size or actual.hexdigest() != digest:
            raise SyncError("Archive verification failed")
        # Windows rename is atomic and refuses an existing destination.
        # POSIX rename overwrites, so cross-platform tests use no-clobber link publication.
        if os.name == "nt":
            os.rename(partial, target)
        else:
            os.link(partial, target)
    finally:
        if owned:
            partial.unlink(missing_ok=True)


def validate_windows_destination(value):
    if (not isinstance(value, str) or len(value) > 240
            or not re.fullmatch(r"""[A-Za-z]:\\[^<>:"'/|?*`\x00-\x1f\x7f]+""", value)):
        raise SyncError("Invalid Windows destination")
    for part in value.split("\\")[1:]:
        if (not part or part in (".", "..") or part.endswith((".", " "))
                or re.fullmatch(r"(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part)):
            raise SyncError("Invalid Windows destination")
    return value


def destination(value):
    validate_windows_destination(value)
    if os.name != "nt":
        raise SyncError("Windows destination required")
    path = Path(value)
    # Refuse existing junctions/symlinks in any ancestor.
    for parent in (path, *path.parents):
        if parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()):
            raise SyncError("Destination link refused")
        if os.name == "nt" and parent.exists():
            if parent.lstat().st_file_attributes & 0x400:
                raise SyncError("Destination reparse point refused")
    return path


def sync(config, state_path, opener=None, free_space=shutil.disk_usage, now=time.time,
         resolve_destination=destination, secure_file=protect_archive):
    opener = opener or network_opener()
    origin = validate_origin(config["origin"])
    token = config["token"]
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._~+/=-]{1,8192}", token):
        raise SyncError("Invalid pairing token")
    state = json.loads(state_path.read_text("utf-8")) if state_path.exists() else {}
    cursor = state.get("cursor")
    query = "?" + urllib.parse.urlencode({"cursor": cursor}) if cursor is not None else ""

    def request(path):
        return urllib.request.Request(origin + path, headers={"Authorization": "Bearer " + token,
                                                              "Accept": "application/json"})

    with opener(request("/api/backup-sync/archives" + query), timeout=60) as response:
        page = read_json(response)
    mode = page.get("mode")
    if mode in ("MANUAL", "manual"):
        return False
    if mode not in ("AUTOMATIC", "automatic"):
        raise SyncError("Unknown synchronization mode")
    interval = page.get("intervalMinutes", 30)
    if type(interval) is not int or not 5 <= interval <= 1440:
        interval = 30
    current = now()
    last = state.get("lastSuccessfulRun")
    if isinstance(last, (int, float)) and 0 <= current - last < interval * 60:
        return False
    archives = page["archives"]
    next_cursor = page.get("nextCursor")
    if (not isinstance(archives, list) or len(archives) > 1000
            or (next_cursor is not None and (not isinstance(next_cursor, str) or len(next_cursor) > 4096))):
        raise SyncError("Invalid archive listing")
    for archive in archives:
        archive_info(archive)
    folder = resolve_destination(page.get("folder") or config.get("folder") or DEFAULT_FOLDER)
    folder.mkdir(parents=True, exist_ok=True)
    for archive in archives:
        download(archive, folder, request("/api/backup-sync/archives/" + archive["id"] + "/download"),
                 opener, free_space, secure_file)
    completed = now()
    state.update(lastSuccessfulRun=completed, nextDue=completed + interval * 60)
    # Reconcile from the beginning after the terminal page. An older queued
    # archive may finish after newer rows have already passed this checkpoint.
    # Each run is bounded to one page; existing files are verified, never replaced.
    state["cursor"] = next_cursor
    atomic_write(state_path, json.dumps(state).encode("utf-8"))
    return True


@contextmanager
def run_lock(path):
    with path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--setup", action="store_true")
    parser.add_argument("--run", action="store_true")
    args = parser.parse_args()
    home = Path(__file__).resolve().parent
    try:
        if os.name != "nt":
            raise SyncError("Windows required")
        with run_lock(home / "run.lock"):
            if args.setup:
                # Anonymous stdin pipe only. No secrets in argv, env, logs, plaintext files.
                values = [sys.stdin.buffer.readline(16384).decode("utf-8").rstrip("\r\n") for _ in range(3)]
                save_config(home / "config.dpapi", dict(zip(("origin", "folder", "token"), values)))
                (home / "state.json").unlink(missing_ok=True)
            elif args.run:
                sync(load_config(home / "config.dpapi"), home / "state.json")
            else:
                raise SyncError("Select setup or run")
        return 0
    except Exception:
        # Never print exception/request text: it may contain credentials or URLs.
        if sys.stderr is not None:
            sys.stderr.write("YO CRM: backup sync failed; check connection, pairing and disk space.\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
