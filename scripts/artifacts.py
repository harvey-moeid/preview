"""Passive, bounded archive validation shared by the trusted publisher and tests.

Never extractall(), execute, import or source target files. The archive is data.
"""
import hashlib
import io
import json
import re
import tarfile
import zipfile

MAX_OUTPUT = 100 * 1024 * 1024
MAX_FILE = 25 * 1024 * 1024
MAX_ARCHIVE = 110 * 1024 * 1024
MIME = {'html': 'text/html; charset=utf-8', 'css': 'text/css; charset=utf-8', 'js': 'text/javascript; charset=utf-8', 'mjs': 'text/javascript; charset=utf-8', 'json': 'application/json', 'svg': 'image/svg+xml', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp', 'ico': 'image/x-icon', 'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf', 'txt': 'text/plain; charset=utf-8', 'webmanifest': 'application/manifest+json', 'wasm': 'application/wasm', 'mp4': 'video/mp4', 'mp3': 'audio/mpeg', 'avif': 'image/avif'}

def safe_path(path):
    parts = path.split('/')
    return (len(path) <= 240 and re.fullmatch(r'[a-zA-Z0-9_./@+ -]+', path)
            and not path.startswith('/') and all(p and p not in ('.', '..') and not p.startswith('.') and p.lower() not in ('_worker.js', 'functions', '_headers', '_redirects', 'node_modules') for p in parts)
            and path.rsplit('.', 1)[-1].lower() in MIME)

def validate_tar(data, expected):
    if len(data) > MAX_ARCHIVE:
        raise ValueError('ARCHIVE_TOO_LARGE')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        total = 0
        for index, member in enumerate(archive):
            if index > 5000 or not member.isfile() or member.issym() or member.islnk() or member.mode & 0o111:
                raise ValueError('SPECIAL_FILE_OR_EXECUTABLE')
            name = member.name
            if name in files or (name != 'manifest.json' and not safe_path(name)):
                raise ValueError('INVALID_ARTIFACT_PATH')
            if member.size > (1024 * 1024 if name == 'manifest.json' else MAX_FILE) or member.size < 0:
                raise ValueError('FILE_TOO_LARGE')
            total += member.size
            if total > MAX_OUTPUT + 1024 * 1024:
                raise ValueError('OUTPUT_TOO_LARGE')
            files[name] = archive.extractfile(member).read(member.size + 1)
            if len(files[name]) != member.size:
                raise ValueError('TRUNCATED_FILE')
    manifest = json.loads(files.pop('manifest.json', b'{}'))
    if set(manifest) != {'version', 'jobId', 'sha', 'configHash', 'files'} or manifest['version'] != 1:
        raise ValueError('INVALID_MANIFEST')
    for key in ('jobId', 'sha', 'configHash'):
        if manifest.get(key) != expected[key]:
            raise ValueError('MANIFEST_BINDING')
    listed = manifest['files']
    if not isinstance(listed, list) or not 1 <= len(listed) <= 5000 or 'index.html' not in files:
        raise ValueError('INDEX_REQUIRED')
    seen = set()
    for item in listed:
        if not isinstance(item, dict) or set(item) != {'path', 'size', 'sha256'}:
            raise ValueError('INVALID_MANIFEST_FILE')
        path = item['path']
        if path in seen or path not in files or not safe_path(path):
            raise ValueError('UNEXPECTED_FILE')
        seen.add(path)
        content = files[path]
        if type(item['size']) is not int or len(content) != item['size'] or hashlib.sha256(content).hexdigest() != item['sha256']:
            raise ValueError('CHECKSUM_MISMATCH')
    if seen != set(files) or sum(map(len, files.values())) > MAX_OUTPUT:
        raise ValueError('UNEXPECTED_FILE')
    return files

def artifact_zip(data, allowed):
    if len(data) > MAX_ARCHIVE:
        raise ValueError('ZIP_TOO_LARGE')
    result = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.infolist()) > len(allowed):
            raise ValueError('UNEXPECTED_ZIP_FILE')
        for entry in archive.infolist():
            mode = entry.external_attr >> 16
            if entry.filename not in allowed or entry.filename in result or entry.file_size > allowed[entry.filename] or entry.is_dir() or (mode & 0o170000) == 0o120000:
                raise ValueError('INVALID_ZIP_ENTRY')
            result[entry.filename] = archive.read(entry)
    return result
