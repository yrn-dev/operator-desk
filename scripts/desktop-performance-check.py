"""Packaged Desktop -> RPC -> real Qwen -> dynamic browser -> uploaded bytes.

Fresh Desktop profile, isolated agent history, synthetic local files/server.
"""
import http.server
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlparse, parse_qs

project = Path(__file__).resolve().parents[1]
version = json.loads((project / 'package.json').read_text())['version']
binary = Path(os.environ.get('OPERATOR_TEST_BINARY', str(project / 'release' / version / 'linux-unpacked/operator-desk')))
work = Path(tempfile.mkdtemp(prefix='operator-desktop-performance-'))
agent = work / 'agent'
profile = work / 'config/operator-desk'
agent.mkdir(); profile.mkdir(parents=True)
shutil.copy2(Path.home() / '.opr/agent/auth.json', agent / 'auth.json')
(agent / 'auth.json').chmod(0o600)
(agent / 'settings.json').write_text(json.dumps({'defaultProvider': 'alem-ai', 'defaultModel': 'qwen3-8', 'defaultThinkingLevel': 'off'}))
(profile / 'policy.json').write_text(json.dumps({'rules': [], 'computerUse': True}))
attachment = work / 'authorized attachment.txt'
attachment.write_text('DESKTOP_SYNTHETIC_ATTACHMENT_ONLY')
received = []

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        page = b'''<!doctype html><title>Operator dynamic upload test</title>
        <label>Your name <input id="name"></label>
        <label>Attachment <input id="file" type="file"></label>
        <p id="result">Waiting for attachment</p><span id="clock">0</span>
        <script>
        setInterval(()=>document.querySelector('#clock').textContent=String(Date.now()),70);
        document.querySelector('#file').onchange=async()=>{
          const file=document.querySelector('#file').files[0];
          const response=await fetch('/upload?name='+encodeURIComponent(document.querySelector('#name').value),{method:'POST',body:file});
          document.querySelector('#result').textContent=await response.text();
        };
        </script>'''
        self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(page)

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        name = parse_qs(urlparse(self.path).query).get('name', [''])[0]
        ok = raw == attachment.read_bytes() and name == 'Test Name'
        received.append({'correctBytes': raw == attachment.read_bytes(), 'correctName': name == 'Test Name'})
        self.send_response(200 if ok else 400); self.end_headers(); self.wfile.write(b'UPLOAD_ACCEPTED' if ok else b'UPLOAD_REJECTED')

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
prompt = (f'Используй встроенный browser: открой http://127.0.0.1:{server.server_port}/, '
          f'в поле Your name введи Test Name, затем через upload выбери файл {attachment}. '
          'Выбор сразу отправляет файл. Дождись надписи UPLOAD_ACCEPTED и сообщи результат. '
          'Ничего не отправляй повторно, не используй bash или отдельный HTTP-запрос.')
env = dict(os.environ, XDG_CONFIG_HOME=str(work / 'config'), OPERATOR_CODING_AGENT_DIR=str(agent), OPERATOR_DESK_PROMPT=prompt)
env.pop('ELECTRON_RUN_AS_NODE', None)
started = time.monotonic()
log = (work / 'desktop.log').open('w')
proc = subprocess.Popen(['xvfb-run', '-a', str(binary), '--ozone-platform=x11'], cwd=work, env=env,
                        stdout=log, stderr=log, start_new_session=True)
print('Packaged Desktop test evidence:', work, flush=True)
try:
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f'Desktop exited {proc.returncode}; inspect {work}/desktop.log')
        for file in (agent / 'sessions').rglob('*.jsonl'):
            messages = []
            for raw in file.read_text().splitlines():
                try:
                    entry = json.loads(raw)
                    if entry.get('message'):
                        messages.append(entry['message'])
                except ValueError:
                    pass
            if not messages or messages[-1].get('role') != 'assistant' or messages[-1].get('stopReason') != 'stop':
                continue
            calls = [block for m in messages if m.get('role') == 'assistant' for block in m.get('content', []) if block.get('type') == 'toolCall']
            observed = any('UPLOAD_ACCEPTED' in b.get('text', '') for m in messages if m.get('role') == 'toolResult' and m.get('toolName') == 'browser' for b in m.get('content', []))
            answer = ''.join(b.get('text', '') for b in messages[-1].get('content', []) if b.get('type') == 'text')
            result = {'version': version, 'elapsedSeconds': round(time.monotonic() - started, 2),
                      'calls': [{'name': c['name'], 'action': c.get('arguments', {}).get('action')} for c in calls],
                      'received': received, 'observedAcceptance': observed, 'answer': answer,
                      'thinkingCharacters': sum(len(b.get('thinking', '')) for m in messages if m.get('role') == 'assistant' for b in m.get('content', [])),
                      'passed': len(received) == 1 and all(received[0].values()) and observed and any(c['name'] == 'browser' and c.get('arguments', {}).get('action') == 'upload' for c in calls)}
            (work / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
            assert result['passed'], f'Packaged Desktop workflow failed; inspect {work}/result.json'
            assert result['thinkingCharacters'] == 0
            print('PASS', json.dumps(result, ensure_ascii=False), flush=True)
            raise SystemExit(0)
        time.sleep(.3)
    raise TimeoutError(f'No completed workflow in 150 seconds; inspect {work}')
finally:
    server.shutdown(); server.server_close()
    try:
        os.killpg(proc.pid, signal.SIGTERM); proc.wait(timeout=5)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL); proc.wait()
    log.close()
