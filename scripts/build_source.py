"""Run ONLY on a disposable secretless runner. No publisher code calls this module."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import urllib.request
from artifacts import MAX_ARCHIVE, MAX_FILE, MAX_OUTPUT, safe_path

def download_source(owner, repo, sha, destination):
    if not re.fullmatch(r'[\w-]+', owner) or not re.fullmatch(r'[\w.-]+', repo) or not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('INVALID_SOURCE')
    req = urllib.request.Request(f'https://codeload.github.com/{owner}/{repo}/tar.gz/{sha}', headers={'User-Agent': 'BYGA-Preview'})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = response.read(MAX_ARCHIVE + 1)
    if len(data) > MAX_ARCHIVE:
        raise ValueError('SOURCE_TOO_LARGE')
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for index, member in enumerate(archive):
            parts = member.name.split('/')[1:]
            if not parts or parts == ['']:
                continue
            if index > 20000 or any(p in ('.', '..') for p in parts) or member.name.startswith('/') or '\\' in member.name or not (member.isfile() or member.isdir()):
                raise ValueError('UNSAFE_SOURCE_ARCHIVE')
            total += member.size
            if total > MAX_OUTPUT or member.size > MAX_FILE:
                raise ValueError('SOURCE_TOO_LARGE')
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read(MAX_FILE + 1))

def produce(output, target, job, sha, config_hash):
    records = []
    paths = []
    total = 0
    for path in sorted(output.rglob('*')):
        if path.is_symlink():
            raise ValueError('ARTIFACT_SYMLINK')
        if path.is_dir():
            if path.name.lower() in ('functions', 'node_modules') or path.name.startswith('.'):
                raise ValueError('BLOCKED_OUTPUT_DIRECTORY')
            continue
        relative = path.relative_to(output).as_posix()
        if not path.is_file() or not safe_path(relative):
            raise ValueError(f'UNSAFE_OUTPUT_FILE: {relative}')
        content = path.read_bytes()
        total += len(content)
        if len(content) > MAX_FILE or total > MAX_OUTPUT or len(records) >= 5000:
            raise ValueError('OUTPUT_TOO_LARGE')
        records.append({'path': relative, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        paths.append((relative, content))
    if not any(r['path'] == 'index.html' for r in records):
        raise ValueError('INDEX_REQUIRED')
    manifest = json.dumps({'version': 1, 'jobId': job, 'sha': sha, 'configHash': config_hash, 'files': records}).encode()
    with tarfile.open(target, 'w') as archive:
        for name, content in paths + [('manifest.json', manifest)]:
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            entry.mode = 0o644
            archive.addfile(entry, io.BytesIO(content))

def main():
    config = json.loads(os.environ['BUILD_CONFIG'])
    job, sha, config_hash = (os.environ[k] for k in ('JOB_ID', 'SOURCE_SHA', 'CONFIG_HASH'))
    for value, pattern in [(job, r'[a-f0-9]{32}'), (sha, r'[a-f0-9]{40}'), (config_hash, r'[a-f0-9]{64}')]:
        if not re.fullmatch(pattern, value):
            raise ValueError('INVALID_BUILD_INPUT')
    for key in ('root', 'output'):
        value = config[key]
        if value != '.' and (not re.fullmatch(r'[\w./@+-]+', value) or value.startswith('/') or any(p in ('', '.', '..') for p in value.split('/'))):
            raise ValueError('INVALID_CONFIG_PATH')
    base = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / ('byga-source-' + job)
    if base.exists():
        shutil.rmtree(base)
    base.mkdir()
    download_source(os.environ['SOURCE_OWNER'], os.environ['SOURCE_REPO'], sha, base)
    root = base / config['root']
    pm = config['packageManager']
    commands = {'npm': ['npm', 'ci'], 'pnpm': ['pnpm', 'install', '--frozen-lockfile'], 'yarn': ['yarn', 'install', '--immutable'], 'bun': ['bun', 'install', '--frozen-lockfile']}
    # All package scripts and custom shell commands execute here, never in a privileged context.
    clean_env = {'PATH': os.environ['PATH'], 'HOME': str(base), 'CI': 'true', 'NODE_ENV': 'production'}
    if pm != 'none':
        if pm not in commands:
            raise ValueError('INVALID_PACKAGE_MANAGER')
        clean_env.pop('NODE_ENV')  # build-time devDependencies are required
        subprocess.run(commands[pm], cwd=base if any((base / n).exists() for n in ('pnpm-workspace.yaml', 'package-lock.json', 'yarn.lock')) else root, env=clean_env, check=True, timeout=360)
    if config['command']:
        subprocess.run(config['command'], shell=True, executable='/bin/bash', cwd=root, env=clean_env, check=True, timeout=240)
    output = root / config['output']
    if output.is_symlink() or not output.resolve().is_relative_to(base.resolve()):
        raise ValueError('OUTPUT_ESCAPE')
    target = Path(os.environ['RUNNER_TEMP']) / 'artifact.tar'
    produce(output, target, job, sha, config_hash)

if __name__ == '__main__':
    main()
