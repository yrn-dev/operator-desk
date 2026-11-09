"""Run on the VPS after upload: verify every file, back up, then publish."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time

stage = Path(__file__).resolve().parent
site = Path('/var/www/operator-pzero')
downloads = site / 'download'
data = json.loads((stage / 'deploy-input.json').read_text())
version = data['version']
assert re.fullmatch(r'\d+\.\d+\.\d+', version)

def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

for name, expected in data['original'].items():
    original = downloads / name if name in ['SHA256SUMS.txt', 'operator-updates.json'] else site / name
    if name == 'operator-updates.json' and expected is None:
        assert not original.exists(), f'Live update manifest appeared after inspection: {original}'
    else:
        assert digest(original) == expected, f'Live file changed since inspection: {original}'
for artifact in data['artifacts']:
    file = stage / artifact['file']
    assert file.stat().st_size == artifact['bytes'], f'Incomplete upload: {file}'
    assert digest(file) == artifact['sha256'], f'Checksum mismatch: {file}'
    if (downloads / file.name).exists() and not file.name.startswith('latest') and file.name != 'operator-updates.json':
        assert digest(downloads / file.name) == artifact['sha256'], f'Another build already published: {file.name}'
for name, expected in data['pages'].items():
    assert digest(stage / name) == expected, f'Page checksum mismatch: {name}'
index = (stage / 'index.html').read_text()
assert data['previous'] not in index and version in index
for name in re.findall(r'href="\./download/([^"?#]+)', index):
    assert (stage / name).is_file() or (downloads / name).is_file(), f'Broken download link: {name}'
backup = Path('/root/operator-release-backups') / time.strftime(f'{version}-%Y%m%d-%H%M%S', time.gmtime())
backup.mkdir(parents=True)
for name in data['original']:
    original = downloads / name if name in ['SHA256SUMS.txt', 'operator-updates.json'] else site / name
    if original.exists():
        shutil.copy2(original, backup / name)
for name in ['latest.yml', 'latest-linux.yml']:
    if (downloads / name).exists():
        shutil.copy2(downloads / name, backup / name)
shutil.copy2(stage / 'deploy-input.json', backup / 'deploy-input.json')
# Complete versioned downloads first, then feeds and the page announcing them.
artifacts = sorted(data['artifacts'], key=lambda artifact: artifact['file'].startswith('latest'))
for artifact in artifacts:
    source = stage / artifact['file']
    source.chmod(0o644)
    os.replace(source, downloads / source.name)
for name in [f'SHA256SUMS-{version}.txt', 'SHA256SUMS.txt', 'app.js', 'index.html']:
    destination = downloads / name if name.startswith('SHA256SUMS') else site / name
    (stage / name).chmod(0o644)
    os.replace(stage / name, destination)
# Move the previous Desktop installers out of the public download directory,
# after validating them against the checksum list captured before publication.
old_archive = backup / f'old-{data["previous"]}-downloads'
old_archive.mkdir()
old_sums = backup / 'SHA256SUMS.txt'
for line in old_sums.read_text().splitlines():
    match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
    assert match, f'Invalid prior checksum entry: {line!r}'
    expected, name = match.groups()
    if not (name.startswith(f'Operator-{data["previous"]}-') or name == f'CHANGELOG-{data["previous"]}.md'):
        continue
    assert Path(name).name == name, f'Unsafe prior filename: {name!r}'
    original = downloads / name
    if original.exists():
        assert digest(original) == expected, f'Prior release checksum mismatch: {name}'
        shutil.move(original, old_archive / name)
result = {'version': version, 'site': 'https://opr.pzero.kz', 'backup': str(backup),
          'artifactChecksumsVerified': True, 'oldDownloadsArchived': str(old_archive), 'macOSVersion': '0.3.1',
          'publishedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
for folder in [stage, backup]:
    (folder / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
