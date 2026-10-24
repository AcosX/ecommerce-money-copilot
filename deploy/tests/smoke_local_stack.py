"""Build and exercise an isolated local Compose stack, without starting frpc.

Requires Docker Compose v2 and an available 127.0.0.1:5188. Only the randomly
named test project's containers and volumes are removed, even after failure.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import struct
import subprocess
import tempfile
import urllib.error
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "http://127.0.0.1:5188"
MIB = 1024 * 1024

SEED_SESSION = """
import json
from emc_api.config import Settings
from emc_api.db import Database
from emc_api.ids import PLAYER, new_id
from emc_api.models import Player
from emc_api.security import create_session

settings = Settings()
database = Database(settings.database_url.get_secret_value())
with database.sessionmaker() as db:
    player_id = new_id(PLAYER)
    player = Player(id=player_id, acos_sub=player_id, display_name="Compose smoke")
    db.add(player)
    db.flush()
    session = create_session(db, player, settings)
    db.commit()
    print(json.dumps({"token": session.token, "csrf": session.csrf_token}))
database.dispose()
"""


def png_bytes(size: int) -> bytes:
    """A valid 1x1 PNG with an ancillary text chunk, of exactly `size` bytes."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    image = b"\x89PNG\r\n\x1a\n"
    image += chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    image += chunk(b"IDAT", zlib.compress(b"\0\x80\x80\x80"))
    end = chunk(b"IEND", b"")
    text_size = size - len(image) - len(end) - 12
    assert text_size >= 5
    return image + chunk(b"tEXt", b"Note\0" + b"x" * (text_size - 5)) + end


def request(
    path: str,
    *,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
) -> tuple[int, object, bytes]:
    req = urllib.request.Request(ORIGIN + path, data=body, headers=headers or {})
    try:
        response = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def check_uploads(session: dict[str, str]) -> None:
    auth = {
        "Cookie": f"emc_session={session['token']}",
        "X-CSRF-Token": session["csrf"],
        "Origin": ORIGIN,
    }
    for size in (2 * MIB, 10 * MIB, 10 * MIB + 1):
        data = png_bytes(size)
        boundary = "emc-smoke-" + secrets.token_hex(12)
        body = (
            (
                f"--{boundary}\r\n"
                'Content-Disposition: form-data; name="file"; filename="smoke.png"\r\n'
                "Content-Type: image/png\r\n\r\n"
            ).encode()
            + data
            + f"\r\n--{boundary}--\r\n".encode()
        )
        status, headers, raw = request(
            "/api/evidence",
            headers={**auth, "Content-Type": f"multipart/form-data; boundary={boundary}"},
            body=body,
        )
        assert headers.get("X-Request-ID"), "Upload did not reach the API"
        result = json.loads(raw)
        if size > 10 * MIB:
            assert status == 413, f"Oversize file returned {status}"
            assert result["error"]["code"] == "payload_too_large"
            print("PASS 10 MiB + 1 byte rejected by the API (JSON 413)", flush=True)
            continue
        assert status == 201, f"Upload of {size} bytes returned {status}"
        assert result["size_bytes"] == size
        assert result["sha256"] == hashlib.sha256(data).hexdigest()
        assert result["content_type"] == "image/png"
        status, _, downloaded = request(result["download_url"], headers=auth)
        assert status == 200 and downloaded == data, "Downloaded bytes differ"
        print(f"PASS {size // MIB} MiB uploaded through Nginx and downloaded intact", flush=True)

    # Raising the upload allowance must not raise the proxy limit for other APIs.
    status, headers, _ = request(
        "/api/projects", headers={**auth, "Content-Type": "application/json"}, body=b"x" * (2 * MIB)
    )
    assert status == 413 and not headers.get("X-Request-ID"), "Expected Nginx's default limit"
    print("PASS ordinary API retains Nginx's default body limit", flush=True)


def main() -> None:
    project = "emc-smoke-" + secrets.token_hex(6)
    with tempfile.TemporaryDirectory(prefix="emc-compose-smoke-") as temp:
        env_file = Path(temp) / "smoke.env"
        env_file.write_text(
            f"EMC_DEV_DB_ROOT_PASSWORD={secrets.token_hex(24)}\n"
            f"EMC_DEV_DB_PASSWORD={secrets.token_hex(24)}\n"
            f"EMC_SESSION_SECRET={secrets.token_hex(32)}\n",
            encoding="utf-8",
        )
        env = {**os.environ, "EMC_DEV_ENV_FILE": str(env_file)}
        # Do not inherit a developer's DB credentials or Compose service choices.
        for key in ("EMC_DEV_DB_ROOT_PASSWORD", "EMC_DEV_DB_PASSWORD", "COMPOSE_PROFILES"):
            env.pop(key, None)
        compose = [
            "docker",
            "compose",
            "--env-file",
            str(env_file),
            "-p",
            project,
            "-f",
            str(ROOT / "deploy" / "compose.yaml"),
        ]

        def run(
            *args: str, capture: bool = False, timeout: int = 600
        ) -> subprocess.CompletedProcess:
            return subprocess.run(
                [*compose, *args],
                cwd=ROOT,
                env=env,
                check=True,
                text=True,
                capture_output=capture,
                timeout=timeout,
            )

        try:
            print("Building API from the checked-out source", flush=True)
            run("build", "api")
            run("up", "-d", "--wait", "--wait-timeout", "180", "db", "api", "web")
            run("exec", "-T", "web", "nginx", "-t")
            status, _, raw = request("/api/health")
            assert status == 200 and json.loads(raw)["status"] == "ok"
            status, _, _ = request("/")
            assert status == 200, "Static entry point unavailable"
            print(
                "PASS built stack, database migrations, health and static entry point", flush=True
            )
            # Capture credentials in memory only; never echo them into the CI log.
            seeded = run("exec", "-T", "api", "python", "-c", SEED_SESSION, capture=True)
            check_uploads(json.loads(seeded.stdout))
        except BaseException:
            subprocess.run(
                [*compose, "logs", "--no-color", "--tail", "100", "db", "api", "web"],
                cwd=ROOT,
                env=env,
                check=False,
                timeout=30,
            )
            raise
        finally:
            run("down", "--volumes", "--remove-orphans", timeout=120)


if __name__ == "__main__":
    main()
