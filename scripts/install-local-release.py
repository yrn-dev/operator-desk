"""Point the existing Linux launcher at a verified release, preserving rollback."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

project = Path(__file__).resolve().parents[1]
version = json.loads((project / 'package.json').read_text())['version']
installed = Path.home() / '.local/opt' / f'operator-desk-{version}-20261019'
link = installed.parent / 'operator-desk'
desktop = Path.home() / '.local/share/applications/operator-desk.desktop'
evidence = json.loads((project / f'outputs/release-content-{version}.json').read_text())
assert evidence['passed']
expected = next(item['asarSha256'] for item in evidence['results'] if item['platform'] == 'linux')
assert hashlib.sha256((installed / 'resources/app.asar').read_bytes()).hexdigest() == expected
assert (installed / 'operator-desk').is_file()
assert not link.exists() or link.is_symlink(), 'Stable path must not replace another real installation'
backup = Path.home() / 'backups' / time.strftime(f'operator-local-{version}-%Y%m%d-%H%M%S')
backup.mkdir(parents=True)
shutil.copy2(desktop, backup / desktop.name)
if link.is_symlink():
    (backup / 'previous-target.txt').write_text(os.readlink(link))
staged_link = link.with_name('operator-desk.new')
assert not staged_link.exists() and not staged_link.is_symlink()
staged_link.symlink_to(installed, target_is_directory=True)
os.replace(staged_link, link)
content = desktop.read_text().splitlines()
content = [f'Exec={link}/operator-desk %U' if line.startswith('Exec=') else
           f'Comment=Operator Desktop {version}' if line.startswith('Comment=') else line for line in content]
temp = desktop.with_suffix('.desktop.new')
temp.write_text('\n'.join(content) + '\n')
temp.chmod(desktop.stat().st_mode)
os.replace(temp, desktop)
result = {'version': version, 'installed': str(installed), 'launcher': str(desktop),
          'backup': str(backup), 'oldBinaryRetained': True, 'profileUntouched': True}
(backup / 'result.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
