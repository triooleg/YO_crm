"""Desktop pull contract: fake network, real temporary files, no installation."""
import importlib.util
import hashlib
from email.message import Message
import io
import json
import os
from pathlib import Path
import re
import sys
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.request
import urllib.response

sys.dont_write_bytecode = True

HELPER = Path(__file__).resolve().parents[2] / "apps/web/public/backup-sync/yocrm_backup_sync.py"
spec = importlib.util.spec_from_file_location("desktop", HELPER)
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.folder = self.root / "archives"
        self.state = self.root / "state.json"
        self.config = {"origin": "https://crm.yoleotard.com", "token": "FAKE-secret-canary",
                       "folder": str(self.folder)}
        self.payload = b"verified archive bytes"
        self.archive = {"id": "20261026-test_1", "type": "FULL", "createdAt": "2026-10-26T00:00:00Z",
                        "archiveChecksum": hashlib.sha256(self.payload).hexdigest(),
                        "archiveBytes": len(self.payload)}
        self.page = {"mode": "automatic", "folder": str(self.folder), "intervalMinutes": 30,
                     "archives": [self.archive], "nextCursor": "verified-cursor"}
        self.calls = []

    def opener(self, request, timeout):
        self.calls.append(request)
        self.assertEqual(request.get_header("Authorization"), "Bearer FAKE-secret-canary")
        if "/download" in request.full_url:
            return io.BytesIO(self.payload)
        return io.BytesIO(json.dumps(self.page).encode())

    def run_sync(self, **kwargs):
        return desktop.sync(self.config, self.state, opener=self.opener,
                            now=lambda: 10000, resolve_destination=self.fixture_destination,
                            secure_file=self.fixture_acl, **kwargs)

    def fixture_acl(self, path):
        self.assertTrue(path.is_relative_to(self.root))
        self.assertEqual(path.stat().st_size, 0)
        if os.name == "nt":
            desktop.protect_archive(path)

    def fixture_destination(self, value):
        if os.name == "nt":
            return desktop.destination(value)
        # Linux tests keep real temp-file IO; production still requires strict Windows paths.
        path = Path(value)
        if not path.is_absolute() or ".." in path.parts or value.startswith("//"):
            raise desktop.SyncError("Invalid test destination")
        return path

    def files(self):
        return list(self.folder.iterdir()) if self.folder.exists() else []

    def test_manual_is_quiet_and_never_downloads(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            def opener(request, timeout):
                calls.append(request)
                return io.BytesIO(json.dumps({"mode": "manual"}).encode())
            desktop.sync({"origin": "https://crm.yoleotard.com", "token": "fake-token",
                          "folder": root}, Path(root) / "state.json", opener=opener)
            self.assertEqual(len(calls), 1)
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_verified_archive_commits_cursor_and_due(self):
        self.assertTrue(self.run_sync())
        self.assertEqual(self.files()[0].read_bytes(), self.payload)
        self.assertEqual(json.loads(self.state.read_text()), {
            "cursor": "verified-cursor", "lastSuccessfulRun": 10000, "nextDue": 11800})
        self.assertEqual(self.calls[1].full_url,
                         "https://crm.yoleotard.com/api/backup-sync/archives/20261026-test_1/download")

    def test_legacy_archive_id_with_dots_downloads_to_real_file(self):
        self.archive["id"] = "archive.2026-10-26"
        self.assertTrue(self.run_sync())
        target = self.folder / "YO_CRM_archive.2026-10-26.tar.gz"
        self.assertEqual(target.read_bytes(), self.payload)
        self.assertEqual(self.files(), [target])
        self.assertEqual(json.loads(self.state.read_text())["cursor"], "verified-cursor")
        self.assertTrue(self.calls[1].full_url.endswith("/archive.2026-10-26/download"))

    def test_manual_ignores_even_unsafe_destination(self):
        self.page = {"mode": "manual", "folder": "../bad"}
        self.assertFalse(self.run_sync())
        self.assertFalse(self.folder.exists())
        self.assertFalse(self.state.exists())

    def test_backend_uppercase_modes(self):
        self.page["mode"] = "MANUAL"
        self.assertFalse(self.run_sync())
        self.assertFalse(self.folder.exists())
        self.page["mode"] = "AUTOMATIC"
        self.assertTrue(self.run_sync())

    def test_interval_change_is_fetched_before_due_decision(self):
        self.state.write_text(json.dumps({"lastSuccessfulRun": 9500, "cursor": "a/b+?"}))
        self.assertFalse(self.run_sync())
        self.assertIn("cursor=a%2Fb%2B%3F", self.calls[0].full_url)
        self.assertFalse(self.folder.exists())
        self.page["intervalMinutes"] = 5
        self.assertTrue(self.run_sync())
        self.assertEqual(json.loads(self.state.read_text())["nextDue"], 10300)

    def test_interval_bounds_default_to_thirty(self):
        for interval in (None, 4, 1441, "5", True):
            with self.subTest(interval=interval):
                self.page["intervalMinutes"] = interval
                self.run_sync()
                self.assertEqual(json.loads(self.state.read_text())["nextDue"], 11800)
                self.state.unlink()

    def test_daily_interval_defers_after_fetch(self):
        self.page["intervalMinutes"] = 1440
        self.state.write_text('{"lastSuccessfulRun": 1}')
        self.assertFalse(self.run_sync())
        self.assertEqual(len(self.calls), 1)

    def test_identical_file_skips_download(self):
        self.run_sync()
        self.state.unlink()
        self.calls.clear()
        self.run_sync()
        self.assertEqual(len(self.calls), 1)

    def test_conflicting_file_never_overwritten_or_cursor_advanced(self):
        self.run_sync()
        self.state.unlink()
        self.files()[0].write_bytes(b"existing owner copy")
        with self.assertRaises(desktop.SyncError):
            self.run_sync()
        self.assertEqual(self.files()[0].read_bytes(), b"existing owner copy")
        self.assertFalse(self.state.exists())

    def test_same_id_same_size_different_bytes_conflicts_after_full_hash(self):
        self.run_sync()
        self.state.unlink()
        target = self.files()[0]
        conflicting = b"x" * len(self.payload)
        target.write_bytes(conflicting)
        self.calls.clear()
        with self.assertRaises(desktop.SyncError):
            self.run_sync()
        self.assertEqual(target.read_bytes(), conflicting)
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(self.state.exists())

    def test_invalid_ids_never_become_paths_or_download_requests(self):
        for bad in ("../escape", "a/b", "a\\b", ".", "..", "x:y", "x%2fy", "a?b", "a\n", "", "x" * 129,
                    "a" * 7, ".archive123", "_archive123", "-archive123", "archive/../escape", "archive..\\escape"):
            with self.subTest(bad=bad):
                self.archive["id"] = bad
                with self.assertRaises(desktop.SyncError):
                    self.run_sync()
                self.assertFalse(self.folder.exists())
                self.assertFalse(self.state.exists())

    def test_invalid_metadata_is_rejected_before_destination_creation(self):
        for field, value in (("archiveChecksum", "bad"), ("archiveBytes", True),
                             ("archiveBytes", -1), ("archiveBytes", "2x")):
            saved = self.archive[field]
            self.archive[field] = value
            with self.assertRaises(desktop.SyncError):
                self.run_sync()
            self.assertFalse(self.folder.exists())
            self.archive[field] = saved

    def test_backend_bigint_decimal_string_size(self):
        self.archive["archiveBytes"] = str(len(self.payload))
        self.assertTrue(self.run_sync())
        self.assertEqual(self.files()[0].read_bytes(), self.payload)

    def test_hash_mismatch_removes_own_partial_leaves_checkpoint(self):
        self.state.write_text('{"cursor":"old"}')
        self.archive["archiveChecksum"] = "0" * 64
        with self.assertRaises(desktop.SyncError):
            self.run_sync()
        self.assertEqual(self.files(), [])
        self.assertEqual(json.loads(self.state.read_text()), {"cursor": "old"})

    def test_short_and_oversized_downloads_fail_without_cursor(self):
        original_size = self.archive["archiveBytes"]
        for size in (original_size - 1, original_size + 1):
            self.archive["archiveBytes"] = size
            with self.assertRaises(desktop.SyncError):
                self.run_sync()
            self.assertEqual(self.files(), [])
            self.assertFalse(self.state.exists())

    def test_interrupted_stream_cleans_partial(self):
        class Broken(io.BytesIO):
            def read(self, size):
                raise OSError("network stopped")
        def opener(request, timeout):
            return Broken() if "/download" in request.full_url else self.opener(request, timeout)
        with self.assertRaises(OSError):
            desktop.sync(self.config, self.state, opener=opener, resolve_destination=self.fixture_destination,
                         secure_file=self.fixture_acl)
        self.assertEqual(self.files(), [])
        self.assertFalse(self.state.exists())

    def test_existing_partial_is_preserved(self):
        self.folder.mkdir()
        partial = self.folder / "YO_CRM_20261026-test_1.tar.gz.partial"
        partial.write_bytes(b"operator partial")
        orphan = self.folder / "YO_CRM_20261026-test_1.tar.gz.older-attempt.partial"
        orphan.write_bytes(b"crash orphan")
        self.assertTrue(self.run_sync())
        self.assertEqual(partial.read_bytes(), b"operator partial")
        self.assertEqual(orphan.read_bytes(), b"crash orphan")
        target = self.folder / "YO_CRM_20261026-test_1.tar.gz"
        self.assertEqual(target.read_bytes(), self.payload)
        self.assertEqual(json.loads(self.state.read_text())["cursor"], "verified-cursor")
        self.assertEqual(set(self.files()), {partial, orphan, target})

    def test_failed_attempt_cleans_only_own_uuid_partial(self):
        self.folder.mkdir()
        foreign = self.folder / "YO_CRM_20261026-test_1.tar.gz.foreign.partial"
        foreign.write_bytes(b"preserve foreign")
        self.archive["archiveChecksum"] = "0" * 64
        with self.assertRaises(desktop.SyncError):
            self.run_sync()
        self.assertEqual(self.files(), [foreign])
        self.assertEqual(foreign.read_bytes(), b"preserve foreign")
        self.assertFalse(self.state.exists())

    def test_free_space_reserve_prevents_download(self):
        with self.assertRaises(desktop.SyncError):
            self.run_sync(free_space=lambda path: SimpleNamespace(free=desktop.RESERVE_BYTES))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.files(), [])
        self.assertFalse(self.state.exists())

    def test_disk_reserve_is_checked_during_stream(self):
        free = iter((10**12, 0))
        with self.assertRaises(desktop.SyncError):
            self.run_sync(free_space=lambda path: SimpleNamespace(free=next(free)))
        self.assertEqual(self.files(), [])

    def test_atomic_publish_never_overwrites_competing_destination(self):
        operation = "rename" if os.name == "nt" else "link"
        native = getattr(desktop.os, operation)
        def race(source, target):
            target.write_bytes(b"competing copy")
            native(source, target)
        with patch.object(desktop.os, operation, side_effect=race):
            with self.assertRaises(FileExistsError):
                self.run_sync()
        self.assertEqual(self.files()[0].read_bytes(), b"competing copy")
        self.assertFalse(self.state.exists())

    def test_fsync_failure_never_publishes_or_advances(self):
        with patch.object(desktop.os, "fsync", side_effect=OSError("disk failed")):
            with self.assertRaises(OSError):
                self.run_sync()
        self.assertEqual(self.files(), [])
        self.assertFalse(self.state.exists())

    def test_acl_failure_stops_before_archive_network_or_data(self):
        def denied(path):
            self.assertEqual(path.stat().st_size, 0)
            raise OSError("ACL denied")
        with self.assertRaises(OSError):
            desktop.sync(self.config, self.state, opener=self.opener, secure_file=denied,
                         resolve_destination=self.fixture_destination)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.files(), [])
        self.assertFalse(self.state.exists())

    def test_stream_consumes_at_most_expected_bytes_plus_one(self):
        counts = []
        class Excess(io.BytesIO):
            def read(self, size):
                chunk = super().read(size)
                counts.append(len(chunk))
                return chunk
        def opener(request, timeout):
            if request.full_url.endswith("/download"):
                return Excess(b"x" * (desktop.CHUNK * 2))
            return self.opener(request, timeout)
        with self.assertRaises(desktop.SyncError):
            desktop.sync(self.config, self.state, opener=opener, secure_file=self.fixture_acl,
                         resolve_destination=self.fixture_destination)
        self.assertEqual(sum(counts), self.archive["archiveBytes"] + 1)
        self.assertEqual(self.files(), [])

    def test_unknown_mode_is_fail_closed(self):
        self.page["mode"] = "broken"
        with self.assertRaises(desktop.SyncError):
            self.run_sync()
        self.assertFalse(self.folder.exists())

    def test_network_failure_does_not_advance_state_or_make_folder(self):
        self.state.write_text('{"cursor":"old"}')
        def failing(request, timeout):
            raise OSError("FAKE-secret-canary")
        with self.assertRaises(OSError):
            desktop.sync(self.config, self.state, opener=failing)
        self.assertFalse(self.folder.exists())
        self.assertEqual(json.loads(self.state.read_text()), {"cursor": "old"})

    def test_oversized_listing_is_refused(self):
        def oversized(request, timeout):
            return io.BytesIO(b" " * (desktop.MAX_JSON + 1))
        with self.assertRaises(desktop.SyncError):
            desktop.sync(self.config, self.state, opener=oversized)
        self.assertFalse(self.folder.exists())

    def test_bearer_header_injection_is_refused_before_network(self):
        self.config["token"] = "secret\r\nInjected: bad"
        with self.assertRaises(desktop.SyncError):
            self.run_sync()
        self.assertEqual(self.calls, [])

    def test_server_folder_wins_and_local_is_fallback(self):
        self.config["folder"] = str(self.root / "fallback")
        self.run_sync()
        self.assertFalse((self.root / "fallback").exists())
        self.state.unlink()
        self.page["folder"] = ""
        self.run_sync()
        self.assertTrue((self.root / "fallback").is_dir())

    def test_unsafe_destination_refused(self):
        for folder in ("../unsafe", "relative", "//host/share", str(self.root / ".." / "escape")):
            self.page["folder"] = folder
            with self.assertRaises(desktop.SyncError):
                self.run_sync()
        self.assertFalse(self.state.exists())

    def test_failed_second_archive_preserves_first_but_not_cursor(self):
        self.page["archives"].append(dict(self.archive, id="second-archive", archiveChecksum="0" * 64))
        with self.assertRaises(desktop.SyncError):
            self.run_sync()
        self.assertEqual(len(self.files()), 1)
        self.assertFalse(self.state.exists())
        self.page["archives"].pop()
        self.calls.clear()
        self.run_sync()
        self.assertEqual(len(self.calls), 1)

    def test_terminal_page_starts_next_reconciliation_from_beginning(self):
        self.state.write_text('{"cursor":"old"}')
        self.page["nextCursor"] = None
        self.run_sync()
        self.assertIsNone(json.loads(self.state.read_text())["cursor"])

    def test_older_created_later_completed_archive_is_reconciled(self):
        late = dict(self.archive, id="older-queued-backup", createdAt="2026-10-25T00:00:00Z")
        clock = [10000]
        queries = []
        def opener(request, timeout):
            if request.full_url.endswith('/download'):
                return io.BytesIO(self.payload)
            queries.append(request.full_url)
            if len(queries) == 1:
                page = dict(self.page, nextCursor="after-newer")
            elif len(queries) == 2:
                self.assertTrue(request.full_url.endswith('?cursor=after-newer'))
                page = dict(self.page, archives=[], nextCursor=None)
            else:
                self.assertNotIn('cursor=', request.full_url)
                page = dict(self.page, archives=[late, self.archive], nextCursor=None)
            return io.BytesIO(json.dumps(page).encode())
        for _ in range(3):
            desktop.sync(self.config, self.state, opener=opener, now=lambda: clock[0],
                         resolve_destination=self.fixture_destination, secure_file=self.fixture_acl)
            clock[0] += 1800
        self.assertEqual((self.folder / 'YO_CRM_older-queued-backup.tar.gz').read_bytes(), self.payload)
        self.assertIsNone(json.loads(self.state.read_text())['cursor'])

    def test_destination_uses_python39_compatible_lstat(self):
        class Python39Path:
            parents = ()
            def is_symlink(self): return False
            def exists(self): return True
            def stat(self): raise AssertionError('Use lstat compatible with Python 3.9')
            def lstat(self): return SimpleNamespace(st_file_attributes=0)
        path = Python39Path()
        with patch.object(desktop, 'Path', return_value=path), patch.object(desktop.os, 'name', 'nt'):
            self.assertIs(desktop.destination('D:\\YO_CRM_Backups'), path)

    def test_no_local_retention_deletion(self):
        self.folder.mkdir()
        old = self.folder / "old.tar.gz"
        old.write_bytes(b"old")
        self.run_sync()
        self.assertEqual(old.read_bytes(), b"old")

    def test_tls_only_and_no_credential_origins(self):
        for origin in ("http://crm.yoleotard.com", "https://user:pass@crm.yoleotard.com",
                       "https://crm.yoleotard.com/api", "https://crm.yoleotard.com?token=secret"):
            self.config["origin"] = origin
            with self.assertRaises(desktop.SyncError):
                self.run_sync()
        self.assertEqual(self.calls, [])

    def test_redirects_never_forward_bearer(self):
        with self.assertRaises(desktop.SyncError):
            desktop.NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.example")

    def test_real_urllib_chain_sends_no_cross_origin_authorization(self):
        for stage in ("list", "download"):
            for code in (301, 302, 303, 307, 308):
                with self.subTest(stage=stage, code=code):
                    observed = []
                    page = self.page
                    class Transport(urllib.request.BaseHandler):
                        handler_order = 0
                        def https_open(self, request):
                            observed.append((request.full_url, request.get_header("Authorization")))
                            headers = Message()
                            redirect = stage == "list" or request.full_url.endswith("/download")
                            if redirect:
                                headers["Location"] = "https://evil.example/stolen"
                            body = b"" if redirect else json.dumps(page).encode()
                            response = urllib.response.addinfourl(io.BytesIO(body), headers,
                                                                  request.full_url, code if redirect else 200)
                            response.msg = "Redirect" if redirect else "OK"
                            return response
                        http_open = https_open
                    opener = desktop.network_opener()
                    opener.__self__.add_handler(Transport())
                    with self.assertRaises(desktop.SyncError):
                        desktop.sync(self.config, self.state, opener=opener, resolve_destination=self.fixture_destination,
                                     secure_file=self.fixture_acl)
                    self.assertEqual(len(observed), 1 if stage == "list" else 2)
                    self.assertTrue(all(url.startswith("https://crm.yoleotard.com/") for url, _ in observed))
                    self.assertTrue(all(auth == "Bearer FAKE-secret-canary" for _, auth in observed))
                    self.assertFalse(self.state.exists())
                    self.assertEqual(self.files(), [])

    def test_atomic_write_preserves_foreign_and_orphan_temps_and_retries(self):
        target = self.root / "state.json"
        foreign = self.root / "state.json.tmp"
        orphan = self.root / "state.json.older-attempt.tmp"
        foreign.write_bytes(b"foreign")
        orphan.write_bytes(b"orphan")
        desktop.atomic_write(target, b"first verified state")
        desktop.atomic_write(target, b"second verified state")
        self.assertEqual(target.read_bytes(), b"second verified state")
        self.assertEqual(foreign.read_bytes(), b"foreign")
        self.assertEqual(orphan.read_bytes(), b"orphan")
        self.assertEqual(set(self.root.iterdir()), {target, foreign, orphan})

    def test_atomic_write_collision_never_deletes_unowned_temp(self):
        target = self.root / "state.json"
        foreign = self.root / "state.json.collision.tmp"
        foreign.write_bytes(b"foreign collision")
        with patch.object(desktop.uuid, "uuid4", return_value=SimpleNamespace(hex="collision")):
            with self.assertRaises(FileExistsError):
                desktop.atomic_write(target, b"new state")
        self.assertEqual(foreign.read_bytes(), b"foreign collision")
        self.assertFalse(target.exists())

    def test_atomic_write_failure_cleans_only_own_attempt_then_retry_succeeds(self):
        target = self.root / "state.json"
        target.write_bytes(b"previous verified state")
        foreign = self.root / "state.json.tmp"
        foreign.write_bytes(b"preserve")
        with patch.object(desktop.os, "replace", side_effect=OSError("disk failed")):
            with self.assertRaises(OSError):
                desktop.atomic_write(target, b"uncommitted state")
        self.assertEqual(target.read_bytes(), b"previous verified state")
        self.assertEqual(set(self.root.iterdir()), {target, foreign})
        desktop.atomic_write(target, b"verified retry")
        self.assertEqual(target.read_bytes(), b"verified retry")
        self.assertEqual(foreign.read_bytes(), b"preserve")
        self.assertEqual(set(self.root.iterdir()), {target, foreign})

    def test_config_only_writes_encrypted_blob(self):
        path = self.root / "config.dpapi"
        with patch.object(desktop, "dpapi") as unused:
            captured = []
            def protect(data):
                captured.append(json.loads(data))
                return b"FAKE-DPAPI-BLOB"
            desktop.save_config(path, self.config, protect=protect)
            self.assertEqual(path.read_bytes(), b"FAKE-DPAPI-BLOB")
            self.assertNotIn(self.config["token"].encode(), path.read_bytes())
            self.assertEqual(captured, [self.config])
            self.assertEqual(desktop.load_config(path, unprotect=lambda _: json.dumps(self.config).encode()), self.config)
            unused.assert_not_called()

    def test_main_error_never_prints_secret(self):
        stderr = io.StringIO()
        with patch.object(desktop, "run_lock", side_effect=RuntimeError(self.config["token"])), \
                patch.object(sys, "argv", ["helper", "--run"]), patch.object(sys, "stderr", stderr):
            self.assertEqual(desktop.main(), 1)
        self.assertNotIn(self.config["token"], stderr.getvalue())

    def test_state_and_requests_do_not_leak_token(self):
        self.run_sync()
        self.assertNotIn(self.config["token"], self.state.read_text())
        self.assertTrue(all(self.config["token"] not in req.full_url for req in self.calls))

    def test_installer_hash_matches_helper_bytes(self):
        installer = HELPER.with_name("Install-YoCrmBackupSync.ps1").read_text("utf-8-sig")
        embedded = re.search(r"\$ExpectedSHA256 = '([0-9a-f]{64})'", installer)
        self.assertIsNotNone(embedded)
        self.assertEqual(embedded.group(1), hashlib.sha256(HELPER.read_bytes()).hexdigest())

    def test_windows_destination_boundary_on_every_platform(self):
        for valid in (r"D:\YO_CRM_Backups", "C:\\Мои копии\\Архивы", "d:\\" + "a" * 237):
            self.assertEqual(desktop.validate_windows_destination(valid), valid)
        for invalid in ("D:\\", "D:\\" + "a" * 238, r"\\server\share", "//server/share",
                        r"D:\.\copy", r"D:\..\copy", "D:/copy", r"D:\copy.", "D:\\copy ",
                        'D:\\co"py', "D:\\co'py", "D:\\co`py", "D:\\co\npy", "D:\\co\x7fpy", "D:copy",
                        r"D:\copy:stream", r"D:\CON", "D:\\copy\\", r"D:\\copy"):
            with self.subTest(invalid=invalid):
                with self.assertRaises(desktop.SyncError):
                    desktop.validate_windows_destination(invalid)

    def test_installer_task_contract_static_only(self):
        installer = HELPER.with_name("Install-YoCrmBackupSync.ps1").read_text("utf-8-sig")
        self.assertRegex(installer, r"(?m)^\$ExpectedSHA256 = '[a-f0-9]{64}'\r?$")
        for required in ("-AsSecureString", "-LogonType Interactive", "-RunLevel Limited", "-Hidden",
                         "-Minutes 5", "pythonw.exe", "-AtLogOn", "-Disable", "-Remove",
                         "$handler.AllowAutoRedirect = $false", "ZeroFreeBSTR"):
            self.assertIn(required, installer)
        self.assertNotIn("-Password", installer)
        self.assertNotIn("ServerCertificateValidationCallback", installer)

    @unittest.skipUnless(os.name == "nt", "CurrentUser DPAPI requires Windows; mocked persistence seam also covered")
    def test_native_dpapi_synthetic_roundtrip_only(self):
        synthetic = b"SYNTHETIC-DPAPI-ROUNDTRIP-NOT-A-CRM-TOKEN\x00\xff"
        encrypted = desktop.dpapi(synthetic)
        path = self.root / "synthetic.dpapi"
        path.write_bytes(encrypted)
        self.assertNotIn(synthetic, encrypted)
        self.assertNotEqual(encrypted, synthetic)
        self.assertEqual(desktop.dpapi(path.read_bytes(), decrypt=True), synthetic)

    @unittest.skipUnless(os.name == "nt", "Native ACL requires Windows; all targets remain in TempDirectory")
    def test_native_archive_acl_only_user_system_without_directory_changes(self):
        self.folder.mkdir()
        unrelated = self.folder / "unrelated.txt"
        unrelated.write_bytes(b"unrelated")
        tool = str(Path(os.environ["SystemRoot"]) / "System32/icacls.exe")
        def save_acl(path, name):
            output = self.root / name
            subprocess.run([tool, str(path), "/save", str(output), "/q"], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW)
            return output.read_text("utf-16-le").lstrip("\ufeff")
        before_folder = save_acl(self.folder, "before-folder.acl")
        before_unrelated = save_acl(unrelated, "before-file.acl")
        self.run_sync()
        archive = self.folder / "YO_CRM_20261026-test_1.tar.gz"
        actual = save_acl(archive, "archive.acl")
        self.assertIn("D:P", actual)
        self.assertIn(";;;SY)", actual)
        self.assertIn(";;;" + desktop.current_user_sid() + ")", actual)
        self.assertEqual(actual.count("(A;"), 2)
        self.assertEqual(save_acl(self.folder, "after-folder.acl"), before_folder)
        self.assertEqual(save_acl(unrelated, "after-file.acl"), before_unrelated)


if __name__ == "__main__":
    unittest.main()
