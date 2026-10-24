"""Fresh privileged runner; artifact contents are never executed."""
from artifacts import MIME, MAX_ARCHIVE, artifact_zip, validate_tar
from trusted_io import callback, download_artifact, github, plan, put_object

def main():
    p = plan('publish')
    b = p['build']
    run_id = int(b['runId'])
    run = github(f'/actions/runs/{run_id}')
    if (run['conclusion'] != 'success' or run['event'] != 'workflow_dispatch' or run['run_attempt'] != 1
            or run['head_sha'] != p['trustedSha'] or run['path'] != '.github/workflows/build-untrusted.yml'
            or run['display_title'] != f"byga-build:{b['id']}:0"):
        raise ValueError('SOURCE_RUN_BINDING')
    packed = artifact_zip(download_artifact(run_id, 'static-' + b['id']), {'artifact.tar': MAX_ARCHIVE})
    files = validate_tar(packed['artifact.tar'], {'jobId': b['id'], 'sha': b['analysis']['sha'], 'configHash': b['configHash']})
    for path, data in files.items():
        put_object(p['prefix'] + '/' + path, data, MIME[path.rsplit('.', 1)[-1].lower()])
    callback(p, 'published', bytes=sum(map(len, files.values())))
    print(f'Published {len(files)} validated passive static objects')

if __name__ == '__main__':
    main()
