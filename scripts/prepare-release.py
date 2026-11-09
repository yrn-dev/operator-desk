"""Stage release downloads and pages; keep a manifest for checked publication."""
import hashlib
import json
import os
from pathlib import Path
import re

project = Path(__file__).resolve().parents[1]
version = json.loads((project / 'package.json').read_text())['version']
release = project / 'release' / version
stage = project / 'release' / f'deploy-{version}'
site = project.parent / 'projects/operator-site'
stage.mkdir(exist_ok=True)
before_index = (stage / 'before/index.html').read_text()
previous = re.search(r'Operator-(\d+\.\d+\.\d+)-win-x64\.exe', before_index).group(1)
assert previous != version, 'The public site already points at this release'

def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

names = [f'Operator-{version}-linux-amd64.deb', f'Operator-{version}-linux-x64.pacman',
         f'Operator-{version}-linux-x86_64.AppImage', f'Operator-{version}-win-x64.exe',
         f'Operator-{version}-win-x64-portable.exe', f'Operator-{version}-win-x64.exe.blockmap',
         'latest.yml', 'latest-linux.yml', 'operator-updates.json']
artifacts = []
for name in names:
    source = release / name
    assert source.stat().st_size > 0, source
    target = stage / name
    if target.exists():
        assert digest(target) == digest(source), f'Staged artifact differs: {name}'
    else:
        os.link(source, target)
    artifacts.append({'file': name, 'bytes': source.stat().st_size, 'sha256': digest(source)})
notes_name = f'CHANGELOG-{version}.md'
(stage / notes_name).write_bytes((project / 'CHANGELOG.md').read_bytes())
artifacts.append({'file': notes_name, 'bytes': (stage / notes_name).stat().st_size,
                  'sha256': digest(stage / notes_name)})

index = before_index.replace(previous, version)
app_js = (stage / 'before/app.js').read_text().replace(previous, version)
index = re.sub(r'\./app\.js\?v=[^"\s]+', f'./app.js?v=release-{version}', index)
update_ru = ('Обновление Linux и Windows: закройте Operator. В Windows запустите установщик и нажмите «Обновить»; '
             'в Linux установите пакет поверх прежнего или замените файл AppImage. Диалоги, ключи и настройки сохранятся.')
update_en = ('Updating Linux and Windows: close Operator. On Windows, run the installer and choose Update; '
             'on Linux, upgrade the existing package or replace the AppImage file. Conversations, keys and settings are preserved.')
update_kz = ('Linux пен Windows жаңарту: Operator-ды жабыңыз. Windows-та орнатқышты іске қосып, қосымшаны жаңартыңыз; '
             'Linux-та қолданыстағы пакетті жаңартыңыз немесе AppImage файлын ауыстырыңыз. Диалогтар, кілттер және баптаулар сақталады.')
index = index if 'data-i18n="install.update"' in index else index.replace('            <p class="os-picker-label"',
    f'            <p class="fineprint" data-i18n="install.update">{update_ru}</p>\n'
    '            <p class="os-picker-label"', 1)
index = index if 'data-i18n="install.releaseNotes"' in index else index.replace('            <p class="fineprint download-checksums">',
    f'            <p class="fineprint"><a href="./download/{notes_name}" data-i18n="install.releaseNotes">Что нового в {version}</a></p>\n'
    '            <p class="fineprint download-checksums">', 1)
for description, translation in ([] if '"install.update"' in app_js else [('Linux and Windows version', update_en), ('Linux пен Windows үшін', update_kz)]):
    lines = app_js.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if '"install.deskt"' in line and description in line:
            notes = f'What’s new in {version}' if translation == update_en else f'{version} нұсқасындағы жаңалықтар'
            lines[i] += f'    "install.update": {json.dumps(translation, ensure_ascii=False)},\n'
            lines[i] += f'    "install.releaseNotes": {json.dumps(notes, ensure_ascii=False)},\n'
    app_js = ''.join(lines)
for artifact in artifacts:
    name = artifact['file']
    if name.endswith(('.deb', '.pacman', '.AppImage', '.exe')):
        size = round(artifact['bytes'] / 1024 / 1024)
        pattern = rf'(href="\./download/{re.escape(name)}"[\s\S]*?class="dl-file">v{re.escape(version)} · [^<]+? · )\d+ МБ'
        index, count = re.subn(pattern, rf'\g<1>{size} МБ', index)
        assert count == 1, f'Missing artifact label: {name}'
assert previous not in index and version in index
assert 'Operator-0.3.1-mac-arm64.dmg' in index and 'Operator-0.3.1-mac-x64.dmg' in index

sums = [f"{artifact['sha256']}  {artifact['file']}" for artifact in artifacts]
for name in ['Operator-0.3.1-mac-arm64.dmg', 'Operator-0.3.1-mac-x64.dmg']:
    sums.append(f'{digest(project / "release" / name)}  {name}')
checksums = '\n'.join(sums) + '\n'
pages = {'index.html': index, 'app.js': app_js, 'SHA256SUMS.txt': checksums,
         f'SHA256SUMS-{version}.txt': checksums}
for name, content in pages.items():
    (stage / name).write_text(content)
manifest = {'version': version, 'previous': previous,
            'original': {name: digest(stage / 'before' / name) for name in ['index.html', 'app.js', 'SHA256SUMS.txt']}
                        | {'operator-updates.json': None},
            'artifacts': artifacts, 'pages': {name: digest(stage / name) for name in pages}}
(stage / 'deploy-input.json').write_text(json.dumps(manifest, indent=2) + '\n')
for name in ['index.html', 'app.js']:
    # Keep the source website in sync with the reviewed release pages.
    (site / name).write_text(pages[name])
print(json.dumps({'version': version, 'staged': str(stage), 'artifacts': len(artifacts)}))
