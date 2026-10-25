import os
from trusted_io import plan
if __name__ == '__main__':
    p = plan('validate')
    url = p['previewUrl']
    if '\n' in url or '\r' in url or not url.startswith('https://'):
        raise ValueError('INVALID_PREVIEW_URL')
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write('url=' + url + '\n')
