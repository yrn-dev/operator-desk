import base64
import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import make_server


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.manifest = root / "latest.json"
        self.server = make_server("127.0.0.1", 0, root / "stats.db", self.manifest, "admin", "test-password")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, path, data=None, auth=False):
        headers = {}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if auth:
            headers["Authorization"] = "Basic " + base64.b64encode(b"admin:test-password").decode()
        request = Request(self.base + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try:
            with urlopen(request) as response:
                return response.status, response.read().decode()
        except HTTPError as error:
            return error.code, error.read().decode()

    def test_consent_api_and_daily_deduplication(self):
        event = {"event": "app_open", "installationId": "4cfccce3-53ad-4408-b165-dddc851931c0", "version": "0.3.2", "platform": "linux"}
        self.assertEqual(self.request("/v1/events", event)[0], 204)
        self.assertEqual(self.request("/v1/events", event)[0], 204)
        self.assertEqual(self.request("/admin")[0], 401)
        self.assertIn("Уникальных установок, открывших приложение: 1", self.request("/admin", auth=True)[1])
        self.assertEqual(self.request("/v1/events", {**event, "event": "agent_used"})[0], 204)
        self.assertIn("Активный", self.request("/admin", auth=True)[1])
        self.assertEqual(self.request("/v1/events", {**event, "hostname": "secret"})[0], 400)

    def test_update_manifest(self):
        self.assertEqual(self.request("/v1/latest?platform=linux")[0], 204)
        self.manifest.write_text(json.dumps({"linux": {"version": "0.3.2", "url": "https://opr.pzero.kz/download/Operator.AppImage"}}))
        self.assertEqual(self.request("/v1/latest?platform=linux")[0], 200)
        self.assertEqual(self.request("/v1/latest?platform=unknown")[0], 400)

    def test_local_dashboard_without_password_and_rejects_foreign_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = make_server("127.0.0.1", 0, Path(tmp) / "events.db", Path(tmp) / "latest.json", "", "", True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with urlopen(f"http://127.0.0.1:{server.server_port}/admin") as response:
                    self.assertEqual(response.status, 200)
                request = Request(f"http://127.0.0.1:{server.server_port}/admin", headers={"Host": "evil.example"})
                with self.assertRaises(HTTPError) as error:
                    urlopen(request)
                self.assertEqual(error.exception.code, 403)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == "__main__":
    unittest.main()
