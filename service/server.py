#!/usr/bin/env python3
"""Small, dependency-free statistics service for Operator Desktop.

The public API accepts only the documented anonymous desktop events. The
dashboard requires HTTP Basic auth and should be exposed through HTTPS.
"""

from __future__ import annotations

import base64
import hmac
import html
import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

VERSION = re.compile(r"^\d+\.\d+\.\d+$")
PLATFORMS = {"linux", "win32", "darwin"}
EVENTS = {"app_open", "agent_used"}
MAX_BODY = 2048


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Store:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(db_path.parent, 0o700)
        db_path.touch(mode=0o600, exist_ok=True)
        os.chmod(db_path, 0o600)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS installations (
                    id TEXT PRIMARY KEY,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    version TEXT NOT NULL,
                    platform TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    installation_id TEXT NOT NULL,
                    event TEXT NOT NULL,
                    day TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    PRIMARY KEY (installation_id, event, day)
                );
                CREATE INDEX IF NOT EXISTS events_day_event ON events(day, event);
            """)

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def record(self, payload: dict) -> bool:
        if set(payload) != {"event", "installationId", "version", "platform"}:
            return False
        event, uid, version, platform = (payload[k] for k in ("event", "installationId", "version", "platform"))
        if not all(isinstance(v, str) for v in (event, uid, version, platform)):
            return False
        try:
            if str(UUID(uid)) != uid.lower():
                return False
        except (ValueError, AttributeError):
            return False
        if event not in EVENTS or platform not in PLATFORMS or not VERSION.fullmatch(version):
            return False
        now = utc_now().isoformat(timespec="seconds")
        day = now[:10]
        with self.connect() as db:
            db.execute("""
                INSERT INTO installations (id, first_seen, last_seen, version, platform)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,
                    version=excluded.version, platform=excluded.platform
            """, (uid, now, now, version, platform))
            db.execute("""
                INSERT OR IGNORE INTO events (installation_id, event, day, received_at)
                VALUES (?, ?, ?, ?)
            """, (uid, event, day, now))
        return True

    def dashboard(self) -> str:
        today = utc_now().date()
        with self.connect() as db:
            installed = db.execute("SELECT COUNT(*) FROM installations").fetchone()[0]
            counts = {}
            for label, days in (("Сегодня", 1), ("7 дней", 7), ("30 дней", 30)):
                since = (today - timedelta(days=days - 1)).isoformat()
                counts[label] = db.execute("""
                    SELECT COUNT(DISTINCT installation_id) FROM events
                    WHERE event='agent_used' AND day >= ?
                """, (since,)).fetchone()[0]
            platforms = db.execute("""
                SELECT platform, COUNT(*) AS n FROM installations GROUP BY platform ORDER BY n DESC
            """).fetchall()
            recent = db.execute("""
                SELECT i.id, i.platform, i.version, i.first_seen, i.last_seen,
                    MAX(CASE WHEN e.event='agent_used' THEN e.day END) AS last_used
                FROM installations i LEFT JOIN events e ON e.installation_id=i.id
                GROUP BY i.id ORDER BY i.last_seen DESC LIMIT 100
            """).fetchall()
        cells = "".join(f"<div class='card'><strong>{n}</strong><span>{html.escape(label)}</span></div>" for label, n in counts.items())
        platforms_html = ", ".join(f"{html.escape(row['platform'])}: {row['n']}" for row in platforms) or "—"
        rows = "".join(
            "<tr>" + "".join(f"<td>{html.escape(str(value or '—'))}</td>" for value in (
                row["id"], row["platform"], row["version"], row["first_seen"], row["last_seen"], row["last_used"]
            )) + "</tr>" for row in recent
        )
        return f"""<!doctype html><html lang='ru'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Operator · статистика</title><style>
body{{font:15px system-ui,sans-serif;background:#151513;color:#eee9dc;max-width:1100px;margin:40px auto;padding:0 18px}}
h1{{font-size:28px}}.muted{{color:#a9a69e;line-height:1.5}}.cards{{display:flex;gap:12px;flex-wrap:wrap;margin:25px 0}}
.card{{display:flex;flex-direction:column;background:#242420;border:1px solid #3b3a35;border-radius:12px;padding:18px;min-width:130px}}
.card strong{{font-size:30px}}.card span{{color:#aaa}}table{{border-collapse:collapse;width:100%;font-size:12px;overflow:auto;display:block}}
th,td{{border-bottom:1px solid #3b3a35;text-align:left;padding:9px;white-space:nowrap}}th{{color:#aaa}}
</style><h1>Operator Desktop</h1><p class='muted'>Уникальных установок, открывших приложение: {installed}. Платформы: {platforms_html}.</p>
<div class='cards'>{cells}</div><p class='muted'>Активный — установка, отправившая запрос агенту в выбранный период. Повторные открытия за день не увеличивают число.</p>
<h2>Последние установки</h2><table><thead><tr><th>ID установки</th><th>ОС</th><th>Версия</th><th>Первый запуск UTC</th><th>Последний запуск UTC</th><th>Последнее использование</th></tr></thead><tbody>{rows}</tbody></table>
<p class='muted'>Скачивания появятся после подключения учёта на сервере раздачи файлов. Старые версии Desktop не отправляют события.</p></html>"""


class Handler(BaseHTTPRequestHandler):
    store: Store
    username: str
    password: str
    manifest: Path
    local_only: bool

    def log_message(self, fmt: str, *args: object) -> None:
        # Do not log IP addresses, request bodies or query strings.
        pass

    def reply(self, status: int, body: bytes = b"", content_type: str = "text/plain; charset=utf-8", auth: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if auth:
            self.send_header("WWW-Authenticate", 'Basic realm="Operator statistics", charset="UTF-8"')
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        if self.local_only:
            return True
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            raw = base64.b64decode(header[6:], validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return False
        user, sep, password = raw.partition(":")
        return bool(sep) and hmac.compare_digest(user, self.username) and hmac.compare_digest(password, self.password)

    def valid_host(self) -> bool:
        if not self.local_only:
            return True
        return self.headers.get("Host") in {
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        }

    def do_GET(self) -> None:
        if not self.valid_host():
            self.reply(403, b"Forbidden host")
            return
        route = urlsplit(self.path)
        if route.path == "/healthz":
            self.reply(200, b"operator-stats-ok")
        elif route.path == "/admin":
            if not self.authorized():
                self.reply(401, b"Authentication required", auth=True)
                return
            self.reply(200, self.store.dashboard().encode(), "text/html; charset=utf-8")
        elif route.path == "/v1/latest":
            platform = parse_qs(route.query).get("platform", [""])[0]
            if platform not in PLATFORMS:
                self.reply(400, b"Invalid platform")
                return
            try:
                releases = json.loads(self.manifest.read_text())
                value = releases[platform]
                assert isinstance(value, dict)
                assert VERSION.fullmatch(value["version"])
                assert isinstance(value["url"], str)
            except (OSError, ValueError, KeyError, TypeError, AssertionError):
                self.reply(204)
                return
            self.reply(200, json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8")
        else:
            self.reply(404, b"Not found")

    def do_POST(self) -> None:
        if not self.valid_host():
            self.reply(403, b"Forbidden host")
            return
        if urlsplit(self.path).path != "/v1/events":
            self.reply(404, b"Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                self.reply(413, b"Invalid body size")
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or not self.store.record(payload):
                self.reply(400, b"Invalid event")
                return
        except (ValueError, UnicodeDecodeError, sqlite3.Error):
            self.reply(400, b"Invalid event")
            return
        self.reply(204)


def make_server(host: str, port: int, db_path: Path, manifest: Path, username: str, password: str, local_only: bool = False) -> ThreadingHTTPServer:
    if local_only and host != "127.0.0.1":
        raise ValueError("Local mode must bind to 127.0.0.1")
    if not local_only and (not username or not password):
        raise ValueError("OPERATOR_STATS_USER and OPERATOR_STATS_PASSWORD are required")
    handler = type("OperatorHandler", (Handler,), {
        "store": Store(db_path), "username": username, "password": password,
        "manifest": manifest, "local_only": local_only,
    })
    return ThreadingHTTPServer((host, port), handler)


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    server = make_server(
        os.getenv("OPERATOR_STATS_HOST", "127.0.0.1"),
        int(os.getenv("OPERATOR_STATS_PORT", "8766")),
        Path(os.getenv("OPERATOR_STATS_DB", str(Path.home() / ".local/share/operator-stats/events.db"))),
        Path(os.getenv("OPERATOR_STATS_MANIFEST", str(root / "latest.json"))),
        os.getenv("OPERATOR_STATS_USER", ""),
        os.getenv("OPERATOR_STATS_PASSWORD", ""),
        os.getenv("OPERATOR_STATS_LOCAL") == "1",
    )
    server.serve_forever()
