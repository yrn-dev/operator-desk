"""Verify public pages, feeds and download sizes after checked VPS publication."""
import hashlib
import json
from pathlib import Path
import re
import urllib.request

project = Path(__file__).resolve().parents[1]
version = json.loads((project / 'package.json').read_text())['version']
stage = project / 'release' / f'deploy-{version}'
manifest = json.loads((stage / 'deploy-input.json').read_text())
origin = 'https://opr.pzero.kz'

def request(path, method='GET', headers=None):
    return urllib.request.urlopen(urllib.request.Request(origin + path, method=method,
        headers={'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0', **(headers or {})}), timeout=45)

index = request('/').read().decode()
assert f'Operator-{version}-win-x64.exe' in index
assert manifest['previous'] not in index
assert f'./app.js?v=release-{version}' in index
def normalize_cloudflare_html(content):
    text = content.decode()
    def decode_email(match):
        data = bytes.fromhex(match.group(1))
        address = bytes(value ^ data[0] for value in data[1:]).decode()
        return f'href="mailto:{address}"'
    text = re.sub(r'href="/cdn-cgi/l/email-protection#([0-9a-f]+)"', decode_email, text)
    text = re.sub(r'<script data-cfasync="false" src="/cdn-cgi/scripts/[a-zA-Z0-9]+/cloudflare-static/email-decode\.min\.js"></script>', '', text)
    text = re.sub(r'<script type="module" src="https://static\.cloudflareinsights\.com/beacon\.min\.js/[^"\s]+"[^>]*></script>\n?', '', text)
    return text.encode()

for name in ['index.html', 'app.js', 'SHA256SUMS.txt', f'SHA256SUMS-{version}.txt']:
    prefix = '/download/' if name.startswith('SHA256SUMS') else '/'
    content = request(f'{prefix}{name}?release={version}').read()
    if name == 'index.html':
        content = normalize_cloudflare_html(content)
        (stage / 'public-index-normalized.html').write_bytes(content)
    assert hashlib.sha256(content).hexdigest() == manifest['pages'][name], f'Public content differs: {name}'
files = []
for artifact in manifest['artifacts']:
    path = '/download/' + artifact['file']
    with request(path, 'HEAD') as response:
        assert response.status == 200
        content_length = response.headers.get('Content-Length')
        if content_length is not None:
            assert int(content_length) == artifact['bytes'], artifact['file']
        else:
            assert artifact['file'] == 'operator-updates.json', artifact['file']
        assert 'attachment' in response.headers.get('Content-Disposition', ''), artifact['file']
    if artifact['file'].startswith('latest') or artifact['file'] == 'operator-updates.json':
        content = request(f'{path}?release={version}').read()
        assert len(content) == artifact['bytes'], artifact['file']
        assert hashlib.sha256(content).hexdigest() == artifact['sha256']
    files.append({'file': artifact['file'], 'bytes': artifact['bytes'], 'http': 200})
    print('PASS public download:', artifact['file'], flush=True)
for suffix in ['win-x64.exe', 'linux-x86_64.AppImage']:
    name = f'Operator-{version}-{suffix}'
    with request('/download/' + name, headers={'Range': 'bytes=0-15'}) as response:
        assert response.status == 206, name
        first = response.read(16)
        assert first.startswith(b'MZ' if suffix.endswith('.exe') else b'\x7fELF'), name
result = {'version': version, 'site': origin, 'passed': True, 'publicPagesMatch': True,
          'cloudflareEmailProtectionAndBeaconNormalized': True, 'feedsMatch': True, 'rangeDownloadsWork': True, 'files': files}
(stage / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'PASS public release {version}, pages, feeds, download sizes and ranged binary downloads')
