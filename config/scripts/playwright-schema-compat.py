#!/usr/bin/env python3
"""Compatibility proxy for Playwright MCP tool schemas.

This copy lives under /config so the 1mcp container can execute it from the
bind-mounted config volume.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from typing import Any, BinaryIO, Optional, Tuple


PLAYWRIGHT_CMD = [
    "npx",
    "-y",
    "@playwright/mcp@latest",
    "--headless",
    "--no-sandbox",
    "--isolated",
    "--executable-path",
    "/usr/bin/chromium-browser",
]


def strip_schema_fields(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: strip_schema_fields(subvalue)
            for key, subvalue in value.items()
            if key != "$schema"
        }
    if isinstance(value, list):
        return [strip_schema_fields(item) for item in value]
    return value


def read_line_message(stream: BinaryIO) -> Tuple[bytes, dict[str, str]]:
    line = stream.readline()
    if not line:
        return b"", {}
    return line.rstrip(b"\r\n"), {}


def read_framed_message(stream: BinaryIO) -> Tuple[bytes, dict[str, str]]:
    headers: dict[str, str] = {}
    header_bytes = bytearray()

    while True:
        line = stream.readline()
        if not line:
            return b"", {}
        header_bytes.extend(line)
        if header_bytes.endswith(b"\r\n\r\n") or header_bytes.endswith(b"\n\n"):
            break

    header_text = header_bytes.decode("utf-8", errors="replace")
    for raw_line in header_text.splitlines():
        if ":" not in raw_line:
            continue
        key, value = raw_line.split(":", 1)
        headers[key.strip().lower()] = value.strip()

    content_length = int(headers.get("content-length", "0"))
    body = stream.read(content_length) if content_length else b""
    return body, headers


def read_message(stream: BinaryIO, mode: Optional[str]) -> Tuple[bytes, dict[str, str], Optional[str]]:
    if mode == "framed":
        body, headers = read_framed_message(stream)
        return body, headers, mode
    if mode == "line":
        body, headers = read_line_message(stream)
        return body, headers, mode

    peek = stream.peek(16) if hasattr(stream, "peek") else b""
    if peek.startswith(b"Content-Length:"):
        body, headers = read_framed_message(stream)
        return body, headers, "framed"
    body, headers = read_line_message(stream)
    return body, headers, "line"


def write_message(stream: BinaryIO, body: bytes, mode: str) -> None:
    if mode == "framed":
        stream.write(f"Content-Length: {len(body)}\r\n\r\n".encode("utf-8"))
    else:
        stream.write(b"")
    stream.write(body)
    if mode == "line":
        stream.write(b"\n")
    stream.flush()


def pump_stdin(proc: subprocess.Popen[bytes]) -> None:
    mode: Optional[str] = None
    try:
        while True:
            body, headers, mode = read_message(sys.stdin.buffer, mode)
            if not body and not headers:
                break
            write_message(proc.stdin, body, mode or "line")
    except BrokenPipeError:
        pass
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass


def pump_stdout(proc: subprocess.Popen[bytes]) -> None:
    mode: Optional[str] = None
    try:
        while True:
            body, headers, mode = read_message(proc.stdout, mode)
            if not body and not headers:
                break

            try:
                message = json.loads(body.decode("utf-8"))
            except json.JSONDecodeError:
                write_message(sys.stdout.buffer, body, mode or "line")
                continue

            result = message.get("result")
            if isinstance(result, dict) and isinstance(result.get("tools"), list):
                result["tools"] = [strip_schema_fields(tool) for tool in result["tools"]]

            encoded = json.dumps(message, separators=(",", ":")).encode("utf-8")
            write_message(sys.stdout.buffer, encoded, mode or "line")
    finally:
        try:
            proc.stdout.close()
        except Exception:
            pass


def main() -> int:
    env = os.environ.copy()
    proc = subprocess.Popen(
        PLAYWRIGHT_CMD,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        env=env,
    )

    stdin_thread = threading.Thread(target=pump_stdin, args=(proc,), daemon=True)
    stdout_thread = threading.Thread(target=pump_stdout, args=(proc,), daemon=True)
    stdin_thread.start()
    stdout_thread.start()

    try:
        return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        return proc.wait()


if __name__ == "__main__":
    raise SystemExit(main())
