"""Executable archive contract: real hostile files, no Docker required."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import backup_archive as archive


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'backup-12345678'
        self.root.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, version=2, members=None):
        (self.root / 'postgres.dump').write_bytes(b'PGDMPtest')
        with tarfile.open(self.root / 'uploads.tar.gz', 'w:gz') as tar:
            for name, kind in members or [('photos/a.txt', 'file')]:
                item = tarfile.TarInfo(name)
                if kind == 'file':
                    item.size = 3
                    tar.addfile(item, io.BytesIO(b'abc'))
                else:
                    item.type = kind
                    item.linkname = '/etc/passwd'
                    tar.addfile(item)
        if version == 1:
            (self.root / 'manifest.txt').write_text('format_version=1\ncompose_project=yoleotard-crm\n')
            names = ['postgres.dump', 'uploads.tar.gz']
        else:
            (self.root / 'manifest.json').write_text(json.dumps(dict(format_version=version,
                backup_id=self.root.name, type='data', app_version='0.10.0', git_commit='a'*40,
                schema_version='migration', database_version='16.0', storage_provider='local',
                files=['postgres.dump', 'uploads.tar.gz'])))
            names = ['postgres.dump', 'uploads.tar.gz', 'manifest.json']
        self.sums(names)

    def sums(self, names):
        (self.root / 'SHA256SUMS').write_text(''.join(
            hashlib.sha256((self.root / name).read_bytes()).hexdigest() + '  ' + name + '\n' for name in names))

    def test_legacy_v1_v2_validate_and_keep_size_semantics(self):
        self.fixture()
        result = archive.validate_directory(self.root)
        self.assertEqual(result['sizeBytes'], sum((self.root / n).stat().st_size for n in
                         ['postgres.dump', 'uploads.tar.gz', 'manifest.json', 'SHA256SUMS']))
        self.assertEqual(result['inventory'][0]['sha256'], 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
        (self.root / 'manifest.json').unlink()
        self.fixture(1)
        self.assertEqual(archive.validate_directory(self.root)['formatVersion'], 1)

    def test_unsigned_coverage_claim_cannot_invent_chatwoot_artifacts(self):
        self.fixture()
        manifest = archive.read_json(self.root/'manifest.json')
        manifest['coverage'] = dict(chatwoot=True, secrets=True, redis=True)
        (self.root/'manifest.json').write_text(json.dumps(manifest))
        self.sums(['postgres.dump','uploads.tar.gz','manifest.json'])
        result = archive.validate_directory(self.root)
        self.assertIs(result['coverage']['chatwoot'], False)
        self.assertIs(result['coverage']['postgresql'], True)
        self.assertIs(result['coverage']['uploads'], True)
        self.assertIs(result['coverage']['secrets'], False)
        self.assertEqual(result['claimedCoverage'], manifest['coverage'])

    def test_hostile_nested_uploads_rejected(self):
        for members in [[('../escape', 'file')], [('/abs', 'file')], [('C:/drive', 'file')],
                        [('a\\b', 'file')], [('a', tarfile.SYMTYPE)], [('a', tarfile.LNKTYPE)],
                        [('a', tarfile.FIFOTYPE)], [('a', 'file'), ('./a', 'file')]]:
            with self.subTest(members=members):
                self.fixture(members=members)
                with self.assertRaises(archive.InvalidArchive):
                    archive.validate_directory(self.root)

    def test_duplicate_json_checksum_and_bomb_fail_closed(self):
        self.fixture()
        with self.assertRaises(archive.InvalidArchive):
            archive.validate_directory(self.root, max_bytes=2)
        with (self.root / 'SHA256SUMS').open('a') as out:
            out.write((self.root / 'SHA256SUMS').read_text().splitlines()[0] + '\n')
        with self.assertRaises(archive.InvalidArchive):
            archive.validate_directory(self.root)
        self.fixture()
        p = self.root / 'manifest.json'
        p.write_text(p.read_text().replace('{', '{"type":"full",', 1))
        self.sums(['postgres.dump', 'uploads.tar.gz', 'manifest.json'])
        with self.assertRaises(archive.InvalidArchive):
            archive.validate_directory(self.root)

    def test_archive_import_promotes_only_validated_directory(self):
        self.fixture()
        archive.pack(self.root)
        destination = Path(self.temp.name) / 'storage'
        destination.mkdir()
        result = archive.import_archive(self.root / 'archive.tar.gz', destination, 'import-12345678')
        self.assertEqual(result['sourceBackupId'], 'backup-12345678')
        self.assertEqual(archive.validate_directory(destination / 'import-12345678')['manifest']['backup_id'], self.root.name)
        with self.assertRaises(archive.InvalidArchive):
            archive.import_archive(self.root / 'archive.tar.gz', destination, 'import-12345678')

    def test_v3_inventory_is_verified_before_acceptance(self):
        self.fixture()
        m = json.loads((self.root/'manifest.json').read_text())
        m.update(format_version=3, consistency=dict(verified=True))
        m['files'] += ['inventory.json','table-counts.json']
        (self.root/'inventory.json').write_text('[]')
        (self.root/'table-counts.json').write_text('{"public.Order":510}')
        (self.root/'manifest.json').write_text(json.dumps(m))
        self.sums(m['files']+['manifest.json'])
        with self.assertRaises(archive.InvalidArchive):
            archive.validate_directory(self.root)
        inventory = archive.scan_tar(self.root/'uploads.tar.gz')
        (self.root/'inventory.json').write_text(json.dumps(inventory))
        self.sums(m['files']+['manifest.json'])
        result = archive.validate_directory(self.root)
        self.assertFalse(result['consistent'])
        self.assertEqual(result['claimedConsistency'], {'verified': True})
        self.assertEqual(result['consistencyTrust'], 'UNVERIFIED')

    def test_import_cannot_self_certify_consistency_with_recomputed_checksums(self):
        self.fixture()
        m = archive.read_json(self.root/'manifest.json')
        m.update(format_version=3, consistency={'verified': True, 'method': 'stopped-writers'})
        m['files'] += ['inventory.json', 'table-counts.json']
        (self.root/'inventory.json').write_text(json.dumps(archive.scan_tar(self.root/'uploads.tar.gz')))
        (self.root/'table-counts.json').write_text('{}')
        (self.root/'manifest.json').write_text(json.dumps(m))
        self.sums(m['files']+['manifest.json'])
        archive.pack(self.root)
        storage = Path(self.temp.name)/'storage'; storage.mkdir()
        result = archive.import_archive(self.root/'archive.tar.gz', storage, 'import-12345678')
        self.assertFalse(result['consistent'])
        self.assertEqual(result['consistencyTrust'], 'UNVERIFIED')

    def test_outer_archive_cannot_write_before_quarantine_or_replace_existing_files(self):
        source = Path(self.temp.name)/'hostile.tar.gz'
        destination = Path(self.temp.name)/'store'
        destination.mkdir()
        with tarfile.open(source,'w:gz') as tar:
            entry=tarfile.TarInfo('../outside')
            entry.size=3
            tar.addfile(entry,io.BytesIO(b'bad'))
        with self.assertRaises(archive.InvalidArchive):
            archive.import_archive(source,destination,'import-12345678')
        self.assertEqual(list(destination.iterdir()),[])
        self.assertFalse((Path(self.temp.name)/'outside').exists())

    def test_archive_file_ancestor_collisions_and_hardlinks_rejected(self):
        self.fixture(members=[('a','file'),('a/b','file')])
        # A structurally impossible tree must fail validation even without extraction.
        with self.assertRaises(archive.InvalidArchive):
            archive.validate_directory(self.root)


if __name__ == '__main__':
    unittest.main()
