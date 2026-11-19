#!/usr/bin/env python3
"""Isolated TLS-only iOS UI fixture. Never a production xDrive Server.

The tests drive the normal native login/Owner/Files/UploadSession code. The
server validates a synthetic bearer and exact MIME/Node/CAS receipts, and
exposes only non-secret operation counters for XCTest assertions.
"""
import argparse
import hashlib
import json
import re
import ssl
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

DEVICE = "123e4567-e89b-42d3-a456-426614174000"
ACCOUNTS = {
    "ui_cloud_valid", "ui_cloud_stale", "ui_revoke403", "ui_revoke404",
    "ui_cas_ok", "ui_cas_bad", "ui_lifecycle", "ui_slow",
}
CHUNK_SIZE = 8 * 1_048_576
LOCK = threading.RLock()
STATE = {name: {"writes": [], "uploads": {}, "upload_creates": 0,
                "upload_chunks": 0, "upload_finalizes": 0,
                "revoke_attempts": 0, "revokes": 0,
                "revoked": False} for name in ACCOUNTS}


def file_node(identifier, name, size, revision):
    return {"id": identifier, "parent_id": 1, "name": name,
            "type": "file", "size": size, "revision": revision}


def upload_snapshot(record, finalized=False):
    chunks = []
    if record["part"] is not None:
        chunks = [{"index": 0, "size": len(record["part"]),
                   "sha256": hashlib.sha256(record["part"]).hexdigest()}]
    return {
        "id": record["id"], "parent_id": 1, "name": record["name"],
        "size": record["size"], "chunk_size": CHUNK_SIZE, "chunk_count": 1,
        "sha256": record["sha256"],
        "status": "finalized" if finalized else "active",
        "received_chunks": chunks,
        "result": {"id": 60, "name": record["name"], "type": "file",
                   "revision": 2} if finalized else None,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "xDriveClipboardCI/1.0"
    sys_version = ""

    def log_message(self, _format, *_args):
        # Do not log query, bearer, UI contents or uploaded filenames.
        return

    def respond(self, status, obj=None, mime="application/json"):
        body = b"" if obj is None else json.dumps(
            obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        if body:
            self.wfile.write(body)
        self.close_connection = True

    def incoming(self, cap=CHUNK_SIZE + 4096):
        raw_size = self.headers.get("Content-Length", "")
        if not raw_size.isdigit() or int(raw_size) > cap:
            raise ValueError("Invalid bounded request size")
        return self.rfile.read(int(raw_size))

    def posted_json(self):
        data = self.incoming(100_000)
        result = json.loads(data)
        if not isinstance(result, dict):
            raise ValueError("Expected JSON object")
        return result

    def user(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer fixture-"):
            return None
        user = header.removeprefix("Bearer fixture-")
        return user if user in ACCOUNTS else None

    def authorize(self):
        user = self.user()
        if not user:
            self.respond(401, {"error": "unauthorized"})
        return user

    def do_GET(self):
        target = urlsplit(self.path)
        path = target.path
        if path == "/__fixture/health":
            return self.respond(200, {"status": "ready"})
        if path == "/__fixture/stats":
            user = parse_qs(target.query).get("user", [""])[0]
            if user not in ACCOUNTS:
                return self.respond(404, {"error": "unknown fixture"})
            with LOCK:
                state = STATE[user]
                result = {
                    "writes": len(state["writes"]),
                    "last_node": state["writes"][-1].get("node_id", 0)
                        if state["writes"] else 0,
                    "upload_creates": state["upload_creates"],
                    "upload_chunks": state["upload_chunks"],
                    "upload_finalizes": state["upload_finalizes"],
                    "revoke_attempts": state["revoke_attempts"],
                    "revokes": state["revokes"],
                }
            return self.respond(200, result)
        user = self.authorize()
        if user is None:
            return
        if path == "/api/v1/me":
            return self.respond(200, {
                "id": 7, "username": user, "role": "user",
                "must_change_password": False,
                "pwa_offline_instance_id": "ci-clipboard-" + user,
            })
        if path == "/api/v1/nodes/root":
            return self.respond(200, {
                "id": 1, "parent_id": None, "type": "dir",
                "name": "", "size": 0, "revision": 1,
            })
        if path == "/api/v1/clipboard/devices":
            with LOCK:
                revoked = STATE[user]["revoked"]
            devices = [] if revoked else [{
                "device_id": DEVICE, "name": "Fixture iPhone", "platform": "ios",
            }]
            if user == "ui_slow":
                time.sleep(2)
            return self.respond(200, {"devices": devices})
        if path == "/api/v1/clipboard/items":
            with LOCK:
                rows = list(STATE[user]["writes"])
            return self.respond(200, {"items": rows[-50:][::-1], "next_before": None})
        if path == "/api/v1/clipboard/events":
            return self.respond(503, {"error": "SSE intentionally unavailable"})
        if path == "/api/v1/nodes/1/children":
            offset = int(parse_qs(target.query).get("offset", ["0"])[0])
            limit = int(parse_qs(target.query).get("limit", ["64"])[0])
            rows = [file_node(55, "clip.png", 32, 4)]
            return self.respond(200, {
                "items": rows[offset:offset + limit], "total_count": len(rows),
                "offset": offset, "limit": limit, "sort": "name", "order": "asc",
            })
        if path == "/api/v1/nodes/55":
            return self.respond(200, file_node(55, "clip.png", 32,
                                               5 if user == "ui_cloud_stale" else 4))
        if path == "/api/v1/nodes/60":
            with LOCK:
                ready = [u for u in STATE[user]["uploads"].values()
                         if u["finalized"]]
            if not ready:
                return self.respond(404, {"error": "unknown node"})
            entry = ready[-1]
            name = "receipt-name-mismatch.png" if user == "ui_cas_bad" else entry["name"]
            data = file_node(60, name, entry["size"], 2)
            data["sha256"] = entry["sha256"]
            return self.respond(200, data)
        match = re.fullmatch(r"/api/v1/uploads/([0-9a-f-]+)", path)
        if match:
            with LOCK:
                entry = STATE[user]["uploads"].get(match.group(1))
            if entry is None:
                return self.respond(404, {"error": "unknown upload"})
            return self.respond(200, upload_snapshot(entry, entry["finalized"]))
        return self.respond(404, {"error": "no fixture route"})

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/api/v1/auth/login":
            try:
                fields = self.posted_json()
            except (ValueError, json.JSONDecodeError):
                return self.respond(400, {"error": "invalid login"})
            user = fields.get("username")
            if user not in ACCOUNTS or fields.get("password") != "fixture-password":
                return self.respond(401, {"error": "invalid credentials"})
            return self.respond(200, {
                "access_token": "fixture-" + user,
                "refresh_token": "fixture-refresh-" + user,
                "username": user, "must_change_password": False,
            })
        user = self.authorize()
        if user is None:
            return
        if path == "/api/v1/clipboard/items":
            try:
                payload = self.posted_json()
                event = str(uuid.UUID(payload.get("client_event_id", "")))
                assert event == payload["client_event_id"]
                assert payload.get("target_device_id") == DEVICE
                kind = payload.get("kind")
                node = payload.get("node_id")
                text = payload.get("content")
                if kind in ("image/x-xdrive-node-ref",
                            "application/x-xdrive-node-ref"):
                    assert node in (55, 60) and text == "asset:" + str(node)
                    if node == 60:
                        assert any(x["finalized"] for x in STATE[user]["uploads"].values())
                else:
                    assert kind in ("text/plain", "text/uri-list")
                    assert isinstance(text, str) and len(text) > 0
                    assert node in (None, 0)
                with LOCK:
                    assert not STATE[user]["revoked"]
                    receipt = {
                        "id": 700 + len(STATE[user]["writes"]),
                        "client_event_id": event, "kind": kind, "content": text,
                        "created_at": "2026-11-14T00:00:00Z",
                        "expires_at": "2026-11-15T00:00:00Z",
                        "target_device_id": DEVICE, "node_id": node,
                    }
                    STATE[user]["writes"].append(receipt)
            except (ValueError, KeyError, AssertionError, TypeError, json.JSONDecodeError):
                return self.respond(400, {"error": "invalid clipboard write"})
            return self.respond(201, receipt)
        if path == "/api/v1/uploads":
            try:
                payload = self.posted_json()
                assert payload["parent_id"] == 1
                assert payload["chunk_size"] == CHUNK_SIZE
                assert payload["size"] in range(1, CHUNK_SIZE + 1)
                assert re.fullmatch(r"[0-9a-f]{64}", payload["sha256"])
                assert payload["resume_key"].startswith("iosmanual_")
                assert payload.get("conflict_policy") == "fail"
                assert isinstance(payload["name"], str) and payload["name"].endswith(".png")
                upload_id = str(uuid.uuid4())
                record = {
                    "id": upload_id, "name": payload["name"],
                    "size": payload["size"], "sha256": payload["sha256"],
                    "part": None, "finalized": False,
                }
                with LOCK:
                    STATE[user]["uploads"][upload_id] = record
                    STATE[user]["upload_creates"] += 1
            except (KeyError, AssertionError, ValueError, TypeError, json.JSONDecodeError):
                return self.respond(400, {"error": "invalid upload"})
            return self.respond(201, upload_snapshot(record))
        match = re.fullmatch(r"/api/v1/uploads/([0-9a-f-]+)/finalize", path)
        if match:
            with LOCK:
                record = STATE[user]["uploads"].get(match.group(1))
                if record and record["part"] is not None and not record["finalized"] \
                        and hashlib.sha256(record["part"]).hexdigest() == record["sha256"]:
                    record["finalized"] = True
                    STATE[user]["upload_finalizes"] += 1
                    snapshot = upload_snapshot(record, finalized=True)
                else:
                    snapshot = None
            return self.respond(200, snapshot) if snapshot else self.respond(
                409, {"error": "chunk missing"})
        return self.respond(404, {"error": "no fixture route"})

    def do_PUT(self):
        path = urlsplit(self.path).path
        user = self.authorize()
        if user is None:
            return
        match = re.fullmatch(r"/api/v1/uploads/([0-9a-f-]+)/chunks/0", path)
        if not match:
            return self.respond(404, {"error": "no fixture route"})
        try:
            data = self.incoming()
        except ValueError:
            return self.respond(413, {"error": "invalid chunk"})
        with LOCK:
            record = STATE[user]["uploads"].get(match.group(1))
            if not record or record["part"] is not None:
                return self.respond(409, {"error": "duplicate chunk"})
            hash_value = hashlib.sha256(data).hexdigest()
            if len(data) != record["size"] or hash_value != record["sha256"] \
                    or hash_value != self.headers.get("X-Chunk-SHA256"):
                return self.respond(400, {"error": "chunk digest mismatch"})
            record["part"] = data
            STATE[user]["upload_chunks"] += 1
        return self.respond(200, {"index": 0, "size": len(data),
                                  "sha256": hash_value})

    def do_DELETE(self):
        path = urlsplit(self.path).path
        user = self.authorize()
        if user is None:
            return
        if path == "/api/v1/clipboard/devices/" + DEVICE:
            with LOCK:
                state = STATE[user]
                state["revoke_attempts"] += 1
                if user == "ui_revoke403":
                    return self.respond(403, {"error": "not permitted"})
                if user == "ui_revoke404":
                    return self.respond(404, {"error": "not found"})
                state["revokes"] += 1
                state["revoked"] = True
            return self.respond(204)
        return self.respond(404, {"error": "no fixture route"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--port", type=int, default=19443)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
    ssl_context.load_cert_chain(certfile=args.cert, keyfile=args.key)
    server.socket = ssl_context.wrap_socket(server.socket, server_side=True)
    server.serve_forever(poll_interval=0.1)


if __name__ == "__main__":
    main()
