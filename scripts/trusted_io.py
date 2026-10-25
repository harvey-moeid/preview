"""Trusted-only transport. No target module imports or target subprocess execution."""
import datetime
import hashlib
import hmac
import json
import os
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from artifacts import MAX_ARCHIVE

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def read_url(url, headers=None, data=None, method=None, limit=MAX_ARCHIVE):
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError('DOWNLOAD_TOO_LARGE')
    return content

def signed_call(path, payload):
    origin = os.environ['CONTROL_ORIGIN']
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != 'https' or parsed.username or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('INVALID_CONTROL_ORIGIN')
    body = json.dumps(payload, separators=(',', ':')).encode()
    timestamp = str(int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000))
    nonce = secrets.token_hex(16)
    signature = hmac.new(os.environ['PUBLISH_CALLBACK_SECRET'].encode(), timestamp.encode() + b'.' + nonce.encode() + b'.' + body, hashlib.sha256).hexdigest()
    response = json.loads(read_url(origin.rstrip('/') + path, {'Content-Type': 'application/json', 'X-BYGA-Time': timestamp, 'X-BYGA-Nonce': nonce, 'X-BYGA-Signature': signature}, body, 'POST', 262144))
    if not response.get('success'):
        raise ValueError('CONTROL_REJECTED')
    return response['data']

def plan(kind):
    job = os.environ['JOB_ID']
    if not re.fullmatch('[a-f0-9]{32}', job):
        raise ValueError('INVALID_JOB_ID')
    return signed_call('/api/internal/plan', {'jobId': job, 'kind': kind, 'generation': int(os.environ.get('GENERATION', '0'))})

def github(path, binary=False):
    repository = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[\w-]+/[\w.-]+', repository) or not path.startswith('/') or '://' in path:
        raise ValueError('INVALID_GITHUB_PATH')
    url = 'https://api.github.com/repos/' + repository + path
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'User-Agent': 'BYGA-Trusted-Publisher'}
    try:
        content = read_url(url, headers, limit=MAX_ARCHIVE if binary else 1048576)
    except urllib.error.HTTPError as error:
        if not binary or error.code not in (301, 302, 303, 307):
            raise
        location = error.headers.get('Location', '')
        target = urllib.parse.urlsplit(location)
        host = target.hostname or ''
        if target.scheme != 'https' or target.username or not (host.endswith('.blob.core.windows.net') or host.endswith('.githubusercontent.com') or host.endswith('.s3.amazonaws.com')):
            raise ValueError('UNTRUSTED_ARTIFACT_REDIRECT')
        # Never forward GitHub credentials to signed object-storage redirects.
        content = read_url(location)
    return content if binary else json.loads(content)

def download_artifact(run_id, name):
    artifacts = github(f'/actions/runs/{int(run_id)}/artifacts')['artifacts']
    matches = [a for a in artifacts if a['name'] == name and not a['expired']]
    if len(matches) != 1 or matches[0]['size_in_bytes'] > MAX_ARCHIVE:
        raise ValueError('ARTIFACT_NOT_UNIQUE_OR_TOO_LARGE')
    return github(f"/actions/artifacts/{int(matches[0]['id'])}/zip", binary=True)

def put_object(key, content, content_type):
    account, bucket = os.environ['CF_ACCOUNT_ID'], os.environ['PREVIEW_R2_BUCKET']
    if not re.fullmatch('[a-f0-9]{32}', account) or not re.fullmatch('[a-z0-9-]{3,63}', bucket):
        raise ValueError('INVALID_R2_CONFIG')
    host = account + '.r2.cloudflarestorage.com'
    uri = '/' + bucket + '/' + urllib.parse.quote(key, safe='/~')
    now = datetime.datetime.now(datetime.timezone.utc)
    timestamp, date = now.strftime('%Y%m%dT%H%M%SZ'), now.strftime('%Y%m%d')
    payload_hash = hashlib.sha256(content).hexdigest()
    canonical_headers = f'content-type:{content_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{timestamp}\n'
    signed_headers = 'content-type;host;x-amz-content-sha256;x-amz-date'
    canonical = f'PUT\n{uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}'
    scope = date + '/auto/s3/aws4_request'
    to_sign = 'AWS4-HMAC-SHA256\n' + timestamp + '\n' + scope + '\n' + hashlib.sha256(canonical.encode()).hexdigest()
    signing = ('AWS4' + os.environ['CF_R2_PUBLISH_TOKEN']).encode()
    for piece in (date, 'auto', 's3', 'aws4_request'):
        signing = hmac.new(signing, piece.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing, to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = f"AWS4-HMAC-SHA256 Credential={os.environ['R2_ACCESS_KEY_ID']}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    read_url('https://' + host + uri, {'Content-Type': content_type, 'x-amz-content-sha256': payload_hash, 'x-amz-date': timestamp, 'Authorization': authorization}, content, 'PUT', 65536)

def callback(p, kind, **extra):
    b = p['build']
    signed_call('/api/internal/publish-result', {'jobId': b['id'], 'runId': int(os.environ['GITHUB_RUN_ID']), 'sha': b['analysis']['sha'], 'configHash': b['configHash'], 'generation': b['validationGeneration'], 'kind': kind, **extra})
