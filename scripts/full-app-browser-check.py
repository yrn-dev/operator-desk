"""Exercise the packaged Desktop, renderer, RPC, real model and browser together.

Uses a fresh Desktop profile on a virtual display; existing provider credentials
are read by Operator itself. No credentials or private page contents are logged.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse

project = Path(__file__).resolve().parents[1]
binary = Path(os.environ.get('OPERATOR_TEST_BINARY', '/opt/Operator/operator-desk' if '--installed' in sys.argv else project / 'release/linux-unpacked/operator-desk'))
sessions = Path.home() / '.opr/agent/sessions/--home-yernur--'
existing = set(sessions.glob('*.jsonl'))
work = Path(tempfile.mkdtemp(prefix='operator-full-app-check-'))
profile = work / 'config/operator-desk'
profile.mkdir(parents=True)
(profile / 'policy.json').write_text(json.dumps({'rules': [], 'computerUse': True}))
prompt = 'Открой мой сайт dev1.pzero.kz. Только открой страницу и коротко назови её заголовок.'
env = dict(os.environ, XDG_CONFIG_HOME=str(work / 'config'), OPERATOR_DESK_PROMPT=prompt)
env.pop('ELECTRON_RUN_AS_NODE', None)
log = (work / 'process.log').open('w')
process = subprocess.Popen(['xvfb-run', '-a', str(binary), '--ozone-platform=x11'],
                           env=env, cwd=Path.home(), stdout=log, stderr=log, start_new_session=True)
print('Started complete Desktop test; evidence:', work, flush=True)
result = None
try:
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Desktop exited early: {process.returncode}; see {work}/process.log')
        for session in set(sessions.glob('*.jsonl')) - existing:
            messages = []
            for raw in session.read_text().splitlines():
                try:
                    item = json.loads(raw)
                    if item.get('message'):
                        messages.append(item['message'])
                except json.JSONDecodeError:
                    pass
            if not any(m.get('role') == 'user' and prompt in json.dumps(m, ensure_ascii=False) for m in messages):
                continue
            calls = [b for m in messages if m.get('role') == 'assistant' for b in m.get('content', []) if b.get('type') == 'toolCall']
            outputs = [m for m in messages if m.get('role') == 'toolResult']
            completed = messages and messages[-1].get('role') == 'assistant' and messages[-1].get('stopReason') == 'stop'
            if not completed:
                continue
            browser_results = []
            for message in outputs:
                if message.get('toolName') != 'browser':
                    continue
                for block in message.get('content', []):
                    if block.get('type') != 'text':
                        continue
                    try:
                        page = json.loads(block['text'])
                        browser_results.append({k: page.get(k) for k in ['title', 'url', 'loading', 'error']})
                    except json.JSONDecodeError:
                        pass
            result = {
                'session': str(session),
                'model': next((m.get('model') for m in messages if m.get('role') == 'assistant'), None),
                'calls': [{'name': c['name'], 'action': c.get('arguments', {}).get('action')} for c in calls],
                'pages': browser_results,
                'answer': ''.join(b.get('text', '') for b in messages[-1].get('content', []) if b.get('type') == 'text'),
            }
            (work / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
            assert any(urlparse(p.get('url') or '').hostname == 'dev1.pzero.kz' and p.get('title') and not p.get('error') for p in browser_results), result
            assert not any(c['name'] == 'computer' for c in calls), result
            print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
            print('PASS full Desktop: real model chose browser and read the requested site', flush=True)
            break
        if result:
            break
        time.sleep(1)
    if result is None:
        raise TimeoutError(f'No completed agent turn in 150s; evidence: {work}')
finally:
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    log.close()
