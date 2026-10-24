"""Local mock runner: actual fixture output -> tar -> trusted passive scanner."""
import base64
import json
from pathlib import Path
import sys
import tempfile
from build_source import produce
from artifacts import validate_tar
root, job, sha, config_hash = sys.argv[1:]
with tempfile.TemporaryDirectory() as temp:
    archive = Path(temp) / 'artifact.tar'
    produce(Path(root), archive, job, sha, config_hash)
    files = validate_tar(archive.read_bytes(), {'jobId': job, 'sha': sha, 'configHash': config_hash})
    print(json.dumps({p: base64.b64encode(content).decode() for p, content in files.items()}))
