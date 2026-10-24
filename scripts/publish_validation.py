import json
import struct
from artifacts import artifact_zip
from trusted_io import callback, download_artifact, plan, put_object
import os

def main():
    p = plan('validate')
    b = p['build']
    generation = b['validationGeneration']
    data = artifact_zip(download_artifact(int(os.environ['GITHUB_RUN_ID']), f"validation-{b['id']}-{generation}"), {'report.json': 65536, 'desktop.png': 5242880, 'mobile.png': 5242880})
    report = json.loads(data['report.json'])
    if (set(report) != {'status', 'errors', 'desktop', 'mobile', 'checkedAt'} or report['status'] not in ('ready', 'partial', 'failed')
            or report['desktop'] != 'desktop.png' or report['mobile'] != 'mobile.png' or not isinstance(report['checkedAt'], int)
            or not isinstance(report['errors'], list) or len(report['errors']) > 100 or any(not isinstance(e, str) or len(e) > 500 for e in report['errors'])):
        raise ValueError('INVALID_REPORT')
    for file in ('desktop.png', 'mobile.png'):
        png = data[file]
        if png[:8] != b'\x89PNG\r\n\x1a\n' or len(png) < 24:
            raise ValueError('INVALID_SCREENSHOT')
        width, height = struct.unpack('>II', png[16:24])
        if width > 2000 or height > 2000:
            raise ValueError('SCREENSHOT_DIMENSIONS')
        put_object(f"evidence/{b['id']}/{generation}/{file}", png, 'image/png')
    callback(p, 'validated', report=report)
    print('Validation evidence accepted')

if __name__ == '__main__':
    main()
