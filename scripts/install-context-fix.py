"""Install the tested local resources, keeping a rollback copy. No session/config edits."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

project = Path('/home/yernur/operator-desk')
source = project / 'release/linux-unpacked/resources'
target = Path('/opt/Operator/resources')
backup = Path('/home/yernur/backups') / f'operator-installed-context-{time.strftime("%Y%m%d-%H%M%S")}'
core = Path('operator/node_modules/pzero-operator/dist/core')
files = [Path('app.asar'), core / 'agent-session.js', core / 'compaction/compaction.js']
for file in files:
    if not (source / file).is_file() or not (target / file).is_file():
        raise SystemExit(f'Missing installation resource: {file}')
bridge = source / 'app.asar.unpacked/dist-electron/bridge'
if not (bridge / 'tool-discovery.mjs').is_file():
    raise SystemExit('Built tool discovery is missing')
backup.mkdir(parents=True)
for file in files:
    (backup / file).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(target / file, backup / file)
shutil.copytree(target / 'app.asar.unpacked', backup / 'app.asar.unpacked')
for file in files:
    staging = target / file.parent / (file.name + '.context-fix-new')
    shutil.copy2(source / file, staging)
    os.replace(staging, target / file)
shutil.copytree(source / 'app.asar.unpacked', target / 'app.asar.unpacked', dirs_exist_ok=True)
for file in files + [Path('app.asar.unpacked/dist-electron/bridge/tool-discovery.mjs'),
                      Path('app.asar.unpacked/dist-electron/bridge/mcp.mjs'),
                      Path('app.asar.unpacked/dist-electron/bridge/desk-bridge.mjs')]:
    assert hashlib.sha256((source / file).read_bytes()).digest() == hashlib.sha256((target / file).read_bytes()).digest(), file
print(json.dumps({'installed': str(target), 'backup': str(backup), 'verified': True}))
