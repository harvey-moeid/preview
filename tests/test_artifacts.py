import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import unittest
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from artifacts import validate_tar, artifact_zip, MAX_FILE

class ArtifactTests(unittest.TestCase):
    expected = {'jobId': 'a' * 32, 'sha': 'b' * 40, 'configHash': 'c' * 64}
    def archive(self, name='index.html', data=b'<h1>Hello</h1>', kind=tarfile.REGTYPE, checksum=None, extra=False):
        manifest = {'version': 1, **self.expected, 'files': [{'path': name, 'size': len(data), 'sha256': checksum or hashlib.sha256(data).hexdigest()}]}
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w') as archive:
            for path, content in [(name, data), ('manifest.json', json.dumps(manifest).encode())] + ([('surprise.js', b'alert(1)')] if extra else []):
                entry = tarfile.TarInfo(path); entry.size = len(content); entry.mode = 0o644
                if path == name: entry.type = kind; entry.linkname = '../outside'
                archive.addfile(entry, io.BytesIO(content))
        return output.getvalue()
    def test_valid_static_data(self):
        self.assertEqual(validate_tar(self.archive(), self.expected)['index.html'], b'<h1>Hello</h1>')
    def test_negative_paths_and_types(self):
        for path in ('../index.html', '/index.html', '_worker.js', 'functions/index.js', '.env', 'startup.sh', 'a\\index.html'):
            with self.subTest(path=path), self.assertRaises(ValueError): validate_tar(self.archive(path), self.expected)
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE):
            with self.subTest(kind=kind), self.assertRaises(ValueError): validate_tar(self.archive(kind=kind), self.expected)
    def test_integrity_and_binding(self):
        with self.assertRaises(ValueError): validate_tar(self.archive(checksum='0'*64), self.expected)
        with self.assertRaises(ValueError): validate_tar(self.archive(), {**self.expected, 'sha': 'd'*40})
        with self.assertRaises(ValueError): validate_tar(self.archive(extra=True), self.expected)
    def test_zip_traversal(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive: archive.writestr('../artifact.tar', b'x')
        with self.assertRaises(ValueError): artifact_zip(output.getvalue(), {'artifact.tar': 100})
    def test_oversize(self):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w') as archive:
            entry = tarfile.TarInfo('index.html'); entry.size = MAX_FILE+1; archive.addfile(entry)
        with self.assertRaises(ValueError): validate_tar(output.getvalue(), self.expected)

if __name__ == '__main__': unittest.main()
