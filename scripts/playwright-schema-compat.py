#!/usr/bin/env python3
"""Compatibility proxy for Playwright MCP tool schemas.

VS Code's MCP client in this environment rejects Playwright tool schemas that
declare JSON Schema draft 2020-12. This proxy launches the real Playwright MCP
server, forwards stdio JSON-RPC traffic unchanged, and strips the top-level
`$schema` declaration from tool definitions before they reach the client.

That keeps the tool parameter shapes intact while avoiding the unsupported
meta-schema path in the client validator.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from typing import Any


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


def pump_stdin(proc: subprocess.Popen[bytes]) -> None:
    try:
        while True:
            chunk = sys.stdin.buffer.readline()
            if not chunk:
                break
            proc.stdin.write(chunk)
            proc.stdin.flush()
    except BrokenPipeError:
        pass
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass


def pump_stdout(proc: subprocess.Popen[bytes]) -> None:
    try:
        while True:
            line = proc.stdout.readline()
            if not line:
                break

            try:
                text = line.decode("utf-8")
            except UnicodeDecodeError:
                sys.stdout.buffer.write(line)
                sys.stdout.buffer.flush()
                continue

            stripped = text.lstrip()
            if not stripped.startswith("{"):
                sys.stdout.write(text)
                sys.stdout.flush()
                continue

            try:
                message = json.loads(text)
            except json.JSONDecodeError:
                sys.stdout.write(text)
                sys.stdout.flush()
                continue

            result = message.get("result")
            if isinstance(result, dict) and isinstance(result.get("tools"), list):
                result["tools"] = [strip_schema_fields(tool) for tool in result["tools"]]

            sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
            sys.stdout.flush()
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
