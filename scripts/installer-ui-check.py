"""Exercise actual NSIS pages in Wine; registry fixtures never touch a real profile."""
import json, os, signal, subprocess, tempfile, time
from pathlib import Path

project = Path(__file__).resolve().parents[1]
root = Path(tempfile.mkdtemp(prefix='operator-installer-ui-'))
prefix = root / 'wine'
installer = Path(os.environ.get('OPERATOR_TEST_INSTALLER', project / 'release/installer-check/Operator-0.3.4-win-x64.exe'))
guid = '91cfe1e4-0e45-5994-a32f-514c69a68196'
install_key = 'HKCU\\Software\\' + guid
uninstall_key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + guid
winpath = lambda p: 'Z:' + str(p).replace('/', '\\')
print('Installer UI evidence:', root, flush=True)
log = (root/'wine.log').open('w')
x = subprocess.Popen(['Xvfb', '-displayfd', '1', '-screen', '0', '1024x768x24', '-nolisten', 'tcp'], stdout=subprocess.PIPE, stderr=log)
display = x.stdout.readline().decode().strip()
env = dict(os.environ, DISPLAY=':'+display, WINEPREFIX=str(prefix), WINEDEBUG='-all', WINEDLLOVERRIDES='mscoree,mshtml=;winemenubuilder.exe=d')
env.pop('ELECTRON_RUN_AS_NODE', None)
helper = root/'controls.exe'
subprocess.run(['winegcc', '-m64', str(project/'scripts/windows-controls.c'), '-o', str(helper)], check=True)
def wine(*args, check=True):
    return subprocess.run(['wine', *args], env=env, stdout=subprocess.PIPE, stderr=log, timeout=60, check=check)
def controls(action=None):
    return subprocess.run([str(helper), *([action] if action else [])], env=env, stdout=subprocess.PIPE, stderr=log, timeout=15).stdout.decode(errors='replace')
results = {}
try:
    wine('wineboot', '-u')
    for p in (prefix/'drive_c/users'/os.environ['USER']).iterdir():
        if p.is_symlink(): p.unlink(); p.mkdir()
    destination = prefix/'drive_c/DeskExisting'
    destination.mkdir()
    for case, version, expected in [('fresh', None, 'Install'), ('update', '0.3.3', 'Update'), ('same', '0.3.4', 'Reinstall'), ('newer', '9.9.9', 'blocked'), ('stale', '0.3.3', 'Install')]:
        wine('reg', 'delete', install_key, '/f', check=False)
        wine('reg', 'delete', uninstall_key, '/f', check=False)
        if version:
            (destination/'Operator.exe').write_text('synthetic detection fixture; never run')
            wine('reg', 'add', install_key, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', 'C:\\DeskExisting', '/f')
            wine('reg', 'add', uninstall_key, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', version, '/f')
        if case == 'stale': (destination/'Operator.exe').unlink()
        proc = subprocess.Popen(['wine', winpath(installer), '/currentuser'], env=env, stdout=log, stderr=log, start_new_session=True)
        seen = ''
        try:
            for _ in range(120):
                seen = controls()
                if seen: break
                time.sleep(.25)
            for _ in range(6):
                if 'Application folder:' in seen or 'Папка приложения:' in seen or 'avoid a downgrade' in seen or 'более старую' in seen: break
                controls('next'); time.sleep(.3); seen = controls()
            (root/f'{case}.txt').write_text(seen)
            if expected == 'blocked':
                assert 'avoid a downgrade' in seen or 'более старую' in seen, seen
            else:
                expected_ru = {'Install':'Установить','Update':'Обновить','Reinstall':'Переустановить'}[expected]
                assert f'1\t{expected}' in seen or f'1\t{expected_ru}' in seen, seen
                if case in ('update','same'): assert 'C:\\DeskExisting' in seen, seen
            subprocess.run(['import', '-window', 'root', str(root/f'{case}.png')], env=env, stdout=log, stderr=log, check=True)
            results[case] = expected
            print('PASS', case, expected, flush=True)
        finally:
            if proc.poll() is None: os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=10)
            time.sleep(.2)
    (root/'result.json').write_text(json.dumps({'passed':True, 'environment':'Wine', 'cases':results}, indent=2))
finally:
    subprocess.run(['wineserver', '-k'], env=env, stdout=log, stderr=log)
    x.terminate(); x.wait(timeout=10); log.close()
