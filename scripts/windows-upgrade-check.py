"""Install the previous release, then upgrade in an isolated Wine prefix."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
old_version = '0.3.4'
new_version = json.loads((project / 'package.json').read_text())['version']
old_release = project / 'release' / old_version
new_release = project / 'release' / new_version
evidence_base = project.parent / 'backups/operator-release-validation'
evidence_base.mkdir(parents=True, exist_ok=True)
root = Path(tempfile.mkdtemp(prefix='operator-windows-upgrade-', dir=evidence_base))
prefix = Path(os.environ.get('OPERATOR_UPGRADE_WINEPREFIX', str(root / 'wine')))
env = dict(os.environ, WINEPREFIX=str(prefix), WINEDEBUG=os.environ.get('OPERATOR_WINEDEBUG', '-all'), WINEDLLOVERRIDES='mscoree,mshtml=;winemenubuilder.exe=d')
env.pop('ELECTRON_RUN_AS_NODE', None)
winpath = lambda p: 'Z:' + str(p).replace('/', '\\')
print(f'Windows installer upgrade evidence: {root}', flush=True)

def run(label, args):
    print(label, flush=True)
    with (root / f'{label}.log').open('w') as log:
        result = subprocess.run(['xvfb-run', '-a', 'wine', *args], env=env, cwd=root,
                                stdout=log, stderr=log, timeout=600)
    assert result.returncode == 0, f'{label}: exit {result.returncode}; see {root}'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

run('wine-initialize', ['wineboot', '-u'])
for user_folder in (prefix / 'drive_c/users' / os.environ['USER']).iterdir():
    if user_folder.is_symlink():
        user_folder.unlink()
        user_folder.mkdir()
# Wine's PowerShell is a stub that returns success for every command, falsely
# reporting that the app is always running. Exercise NSIS's supported native
# process-enumeration fallback by disabling only that stub in this test prefix.
for powershell in prefix.glob('drive_c/windows/*/WindowsPowerShell/v1.0/powershell.exe'):
    powershell.rename(powershell.with_suffix('.wine-stub'))

run('install-old', [winpath(old_release / f'Operator-{old_version}-win-x64.exe'), '/S', '/currentuser', '/D=C:\\DeskExisting'])
installed = prefix / 'drive_c/DeskExisting'
assert (installed / 'resources/app.asar').exists(), 'Old installer did not install'
old_hash = digest(installed / 'resources/app.asar')
user = prefix / 'drive_c/users' / os.environ['USER']
assert user.exists()
fixtures = {
    user / 'AppData/Roaming/operator-desk/plugins.json': '{"disabled":["custom"],"settings":{"custom":{"saved":true}}}',
    user / 'AppData/Roaming/operator-desk/desk-sessions.json': '["preserved-session.jsonl"]',
    user / 'AppData/Roaming/operator-desk/plugins/custom/plugin.json': '{"id":"custom","name":"Keep user plugin"}',
    user / '.opr/agent/auth.json': '{"example":{"type":"api_key","key":"synthetic-only"}}',
    user / '.opr/agent/settings.json': '{"defaultModel":"qwen3-8"}',
    user / '.opr/agent/sessions/preserved-session.jsonl': '{"type":"session","version":3,"id":"preserved"}\n',
}
for path, content in fixtures.items():
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
shortcuts_before = sorted(str(p.relative_to(prefix)) for p in prefix.glob('drive_c/users/**/*.lnk') if 'Operator' in p.name)
assert shortcuts_before, 'Old installer did not create shortcuts'
# No /D: the new installer must discover and reuse the existing installation.
run('upgrade-new', [winpath(new_release / f'Operator-{new_version}-win-x64.exe'), '/S', '/currentuser'])
new_hash = digest(installed / 'resources/app.asar')
assert old_hash != new_hash
assert new_hash == digest(new_release / 'win-unpacked/resources/app.asar')
for path, content in fixtures.items():
    assert path.read_text() == content, f'Lost or changed user data: {path}'
shortcuts_after = sorted(str(p.relative_to(prefix)) for p in prefix.glob('drive_c/users/**/*.lnk') if 'Operator' in p.name)
assert shortcuts_before == shortcuts_after, 'Duplicate or lost shortcuts'
run('registry', ['reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s'])
registry = (root / 'registry.log').read_text(errors='replace')
assert registry.count('DisplayName    REG_SZ    Operator') == 1, registry
assert new_version in registry and old_version not in registry
evidence = {'from': old_version, 'to': new_version, 'environment': 'Wine', 'passed': True,
            'processDetection': 'native fallback (Wine PowerShell stub disabled)',
            'existingInstallPathReused': True, 'userDataPreserved': True,
            'shortcutsPreserved': True, 'singleUninstallEntry': True, 'installedAsarSha256': new_hash}
(root / 'result.json').write_text(json.dumps(evidence, indent=2))
print(f'PASS Windows installer {old_version} -> {new_version}; data, install path, shortcuts and registry preserved', flush=True)
