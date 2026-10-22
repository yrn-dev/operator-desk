"""Check the packaged Electron/Node and Operator RPC with isolated, synthetic config."""
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time

project = Path(__file__).resolve().parents[1]
release = project / 'release' / (sys.argv[1] if len(sys.argv) > 1 else json.loads((project / 'package.json').read_text())['version'])
platform = sys.argv[2] if len(sys.argv) > 2 else 'linux'
work = Path(tempfile.mkdtemp(prefix=f'operator-release-{platform}-'))
agent = work / 'agent'
agent.mkdir()
(agent / 'auth.json').write_text(json.dumps({'alem-ai': {'type': 'api_key', 'key': 'synthetic-offline-check'}}))
(agent / 'settings.json').write_text(json.dumps({'defaultProvider': 'alem-ai', 'defaultModel': 'qwen3-8'}))
windows = platform == 'windows'
folder = release / ('win-unpacked' if windows else 'linux-unpacked')
binary = folder / ('Operator.exe' if windows else 'operator-desk')
cli = folder / 'resources/operator/node_modules/pzero-operator/dist/cli.js'
winpath = lambda p: 'Z:' + str(p).replace('/', '\\')
args = ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-context-files', '--provider', 'alem-ai', '--model', 'qwen3-8']
env = dict(os.environ, ELECTRON_RUN_AS_NODE='1', OPERATOR_CODING_AGENT_DIR=winpath(agent) if windows else str(agent))
if windows:
    env.update(WINEPREFIX=os.environ.get('OPERATOR_TEST_WINEPREFIX', str(work / 'wine')), WINEDEBUG='-all', WINEDLLOVERRIDES='mscoree,mshtml=')
    # Create Win32 stdio handles inside cmd.exe. Wine cannot pass Linux pipe
    # handles directly to Electron's embedded Node (open EBADF).
    input_file = work / 'rpc-input.txt'
    output_file = work / 'rpc-output.txt'
    input_file.write_text('{"id":"release-state","type":"get_state"}\n')
    batch = work / 'rpc.cmd'
    batch.write_text(f'@echo off\r\n"{winpath(binary)}" "{winpath(cli)}" {" ".join(args)} <"{winpath(input_file)}" >"{winpath(output_file)}" 2>"{winpath(work / "runtime-error.log")}"\r\n')
    command = ['xvfb-run', '-a', 'wine', 'cmd', '/d', '/c', winpath(batch)]
else:
    command = [str(binary), str(cli), *args]
print(f'Starting {platform} packaged RPC check; evidence: {work}', flush=True)
with (work / 'stderr.log').open('w') as log:
    proc = subprocess.Popen(command, cwd=work, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=log, start_new_session=True)
    sel = selectors.DefaultSelector()
    if not windows:
        sel.register(proc.stdout, selectors.EVENT_READ)
    response = None
    buffer = b''
    try:
        if not windows:
            proc.stdin.write(b'{"id":"release-state","type":"get_state"}\n')
            proc.stdin.flush()
        deadline = time.monotonic() + (100 if windows else 25)
        while time.monotonic() < deadline:
            if windows:
                for line in output_file.read_text(errors='replace').splitlines() if output_file.exists() else []:
                    try:
                        item = json.loads(line)
                        if item.get('id') == 'release-state': response = item
                    except ValueError:
                        pass
                time.sleep(0.2)
            for key, _ in sel.select(timeout=0.5):
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    sel.unregister(key.fileobj)
                    continue
                buffer += chunk
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    try:
                        item = json.loads(line)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    if item.get('id') == 'release-state':
                        response = item
                        break
            if response is not None:
                break
            if proc.poll() is not None:
                if windows and output_file.exists():
                    for line in output_file.read_text(errors='replace').splitlines():
                        try:
                            item = json.loads(line)
                            if item.get('id') == 'release-state': response = item
                        except ValueError:
                            pass
                    if response is not None: break
                raise RuntimeError(f'Packaged process exited {proc.returncode}; see {work}/stderr.log')
        assert response and response.get('success'), f'No successful RPC response; see {work}/stderr.log'
        state = response['data']
        assert state['model']['id'] == 'qwen3-8', state
        assert state['model']['contextWindow'] == 258000, state
        assert state['autoCompactionEnabled'] is True, state
        assert state['messageCount'] == 0, state
        result = {'platform': platform, 'version': release.name, 'model': state['model']['id'],
                  'contextWindow': state['model']['contextWindow'], 'autoCompaction': True, 'passed': True}
        (work / 'result.json').write_text(json.dumps(result, indent=2))
        print('PASS', json.dumps(result), flush=True)
    finally:
        sel.close()
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=5)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
