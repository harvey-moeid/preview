import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import publish

class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.build = {'id': 'a'*32, 'analysis': {'sha': 'b'*40}, 'configHash': 'c'*64, 'runId': 42}
        self.plan = {'build': self.build, 'prefix': 'previews/bound-id/bound-config', 'trustedSha': 'd'*40}
        self.run = {'conclusion': 'success', 'event': 'workflow_dispatch', 'run_attempt': 1, 'head_sha': 'd'*40, 'path': '.github/workflows/build-untrusted.yml', 'display_title': 'byga-build:' + 'a'*32 + ':0'}
    def tar(self, malicious=False):
        content = b'<h1>passive data</h1>'
        path = '_worker.js' if malicious else 'index.html'
        manifest = {'version': 1, 'jobId': self.build['id'], 'sha': self.build['analysis']['sha'], 'configHash': self.build['configHash'], 'files': [{'path': path, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}]}
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w') as archive:
            for name, data in [(path, content), ('manifest.json', json.dumps(manifest).encode())]:
                member = tarfile.TarInfo(name); member.mode = 0o644; member.size = len(data); archive.addfile(member, io.BytesIO(data))
        return output.getvalue()
    def test_publisher_only_uploads_scanned_data(self):
        with patch.object(publish, 'plan', return_value=self.plan), patch.object(publish, 'github', return_value=self.run), patch.object(publish, 'download_artifact'), patch.object(publish, 'artifact_zip', return_value={'artifact.tar': self.tar()}), patch.object(publish, 'put_object') as put, patch.object(publish, 'callback') as callback:
            publish.main()
            put.assert_called_once_with(self.plan['prefix']+'/index.html', b'<h1>passive data</h1>', 'text/html; charset=utf-8')
            callback.assert_called_once()
    def test_special_worker_blocks_all_uploads_and_callback(self):
        with patch.object(publish, 'plan', return_value=self.plan), patch.object(publish, 'github', return_value=self.run), patch.object(publish, 'download_artifact'), patch.object(publish, 'artifact_zip', return_value={'artifact.tar': self.tar(True)}), patch.object(publish, 'put_object') as put, patch.object(publish, 'callback') as callback:
            with self.assertRaises(ValueError): publish.main()
            put.assert_not_called(); callback.assert_not_called()
    def test_wrong_workflow_sha_and_replay_run_fail_before_download(self):
        for key, bad in [('head_sha', 'e'*40), ('path', '.github/workflows/unreviewed.yml'), ('run_attempt', 2), ('event', 'push'), ('display_title', 'unbound')]:
            with self.subTest(key=key), patch.object(publish, 'plan', return_value=self.plan), patch.object(publish, 'github', return_value={**self.run, key: bad}), patch.object(publish, 'download_artifact') as download:
                with self.assertRaises(ValueError): publish.main()
                download.assert_not_called()

if __name__ == '__main__': unittest.main()
