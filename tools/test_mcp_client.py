#!/usr/bin/env python3
"""Tiny test client for MCP HTTP/SSE JSON-RPC.

This script opens a streamable HTTP session (Accept: text/event-stream) to
`/mcp?sessionId=cli`, then issues JSON-RPC calls to the MCP server using that
sessionId. It calls `list_chat_stores` on the chat-history server and then
attempts `list_chat_sessions` for the first store (if any).

Usage: python3 tools/test_mcp_client.py
"""

import json
import threading
import time
from typing import Optional
import http.client
import urllib.parse
import itertools

MCP_URL = "http://127.0.0.1:3050/mcp"


def initialize_client() -> str:
    """Send an initialize JSON-RPC and return the mcp-session-id header value.

    Returns the session id (trimmed) or raises RuntimeError on failure.
    """
    parsed = urllib.parse.urlparse(MCP_URL)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=10)
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "0.0.1"},
        },
    }
    try:
        body_bytes = json.dumps(body).encode()
        conn.request("POST", parsed.path or "/mcp", body=body_bytes, headers=headers)
        resp = conn.getresponse()
        # Log response status and headers for debug
        try:
            hdrs = dict(resp.getheaders())
        except Exception:
            hdrs = {}
        print(f"[init] resp.status={resp.status} headers={hdrs}")

        # Read and log body (may be empty for successful initialize)
        data = resp.read()
        try:
            text = data.decode(errors="ignore")
        except Exception:
            text = str(data)
        if text:
            print("[init] resp.body:", text)

        # The server typically returns the session id in header mcp-session-id when initialize
        sid = resp.getheader("mcp-session-id") or resp.getheader("Mcp-Session-Id")
        if not sid:
            # try to parse a session id from any JSON body field as a fallback
            try:
                j = json.loads(text) if text else {}
                sid = j.get("sessionId") or j.get("mcp-session-id") or j.get("session_id")
            except Exception:
                sid = None

        if not sid:
            raise RuntimeError(f"initialize failed: status={resp.status} body={text}")

        # trim whitespace and CR
        sid = sid.strip()
        print(f"[init] negotiated session id: {sid}")
        return sid
    finally:
        try:
            conn.close()
        except Exception:
            pass




def stream_thread(session_id: str, stop_event: threading.Event) -> None:
    """Open a streaming GET and print any SSE lines received."""
    # The server requires the client to accept both JSON and text/event-stream
    # and the established session should be provided via the mcp-session-id header.
    headers = {"Accept": "application/json, text/event-stream", "mcp-session-id": session_id}
    parsed = urllib.parse.urlparse(MCP_URL)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=60)
    path = f"/mcp?sessionId={session_id}"
    try:
        conn.putrequest("GET", path)
        # set headers explicitly so we include mcp-session-id
        for k, v in headers.items():
            conn.putheader(k, v)
        conn.endheaders()
        resp = conn.getresponse()
        # print the mcp-session-id header returned by the GET (may differ)
        get_sid = resp.getheader("mcp-session-id") or resp.getheader("Mcp-Session-Id")
        if get_sid:
            print("[stream] GET mcp-session-id:", get_sid.strip())
        content_type = resp.getheader("Content-Type", "") or ""
        if content_type.startswith("application/json"):
            body = resp.read().decode(errors="ignore")
            print("[stream] server response:", body)
            return
        print(f"[stream] connected: status={resp.status}")
        # Iterate over lines from the socket and parse SSE frames
        partial_event = None
        while not stop_event.is_set():
            line = resp.readline()
            if not line:
                # remote closed
                break
            try:
                s = line.decode().rstrip("\r\n")
            except Exception:
                s = str(line)
            if s == "":
                # SSE event separator — if we have an accumulated event, print it
                if partial_event:
                    print("[sse event]", json.dumps(partial_event, indent=2) if isinstance(partial_event, dict) else partial_event)
                    partial_event = None
                continue

            # Print raw SSE line
            print("[sse]", s)

            # Parse 'event:' and 'data:' lines
            if s.startswith("event:"):
                ev = s.split("event:", 1)[1].strip()
                partial_event = {"event": ev, "data": None}
            elif s.startswith("data:"):
                payload = s.split("data:", 1)[1].strip()
                # try to parse JSON payload
                try:
                    payload_j = json.loads(payload)
                except Exception:
                    payload_j = payload
                if partial_event is None:
                    partial_event = {"event": None, "data": payload_j}
                else:
                    partial_event["data"] = payload_j
    except Exception as exc:
        print("[stream] exception:", exc)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def rpc_call(session_id: str, server: str, method: str, params: Optional[dict] = None):
    # backward-compat helper that tries the legacy 1MCP 'call' pattern.
    # Keep this for compatibility, but prefer tools/list and tools/call.
    if not hasattr(rpc_call, "_id_counter"):
        rpc_call._id_counter = itertools.count(2)
    call_id = next(rpc_call._id_counter)
    body = {
        "jsonrpc": "2.0",
        "id": call_id,
        "method": "call",
        "params": {
            "sessionId": session_id,
            "server": server,
            "method": method,
            "params": params or {},
        },
    }
    parsed = urllib.parse.urlparse(MCP_URL)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=10)
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "mcp-session-id": session_id,
    }
    try:
        body_bytes = json.dumps(body).encode()
        conn.request("POST", parsed.path or "/mcp", body=body_bytes, headers=headers)
        resp = conn.getresponse()
        data = resp.read().decode(errors="ignore")
        # server may return text/event-stream with SSE events; try to extract JSON from 'data: ' lines
        content_type = (resp.getheader("Content-Type") or "").lower()
        if content_type.startswith("application/json"):
            try:
                return json.loads(data)
            except Exception:
                print("[rpc] invalid json body:", data)
                return None
        # parse SSE-style response
        if "event:" in data or "data:" in data:
            # find lines starting with 'data:' and try to parse the JSON after it
            for line in data.splitlines():
                line = line.strip()
                if line.startswith("data:"):
                    payload = line[len("data:"):].strip()
                    try:
                        return json.loads(payload)
                    except Exception:
                        # continue searching
                        continue
            print("[rpc] no parsable JSON in SSE response:", data)
            return None
        # fallback
        print("[rpc] non-json response:", resp.status, data)
        return None
    except Exception as exc:
        print(f"[rpc] request failed: {exc}")
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def main() -> None:
    stop_event = threading.Event()
    # initialize and obtain a session id
    print("[init] sending initialize request")
    session_id = None
    try:
        session_id = initialize_client()
    except Exception as exc:
        print("[init] initialize failed:", exc)
        return

    print("[init] got session id:", session_id)

    t = threading.Thread(target=stream_thread, args=(session_id, stop_event), daemon=True)
    t.start()

    # Give the stream a moment to connect. The server needs the long-lived
    # GET to be established before it will accept JSON-RPC POSTs.
    time.sleep(1.0)

    # Preferred flow: request tools list, find chat-history tool names, then call via tools/call
    print("[rpc] requesting tools/list")
    # use a lightweight generic rpc requester
    def rpc_request(session_id: str, method: str, params: Optional[dict] = None):
        parsed = urllib.parse.urlparse(MCP_URL)
        conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=10)
        if not hasattr(rpc_request, "_id_counter"):
            rpc_request._id_counter = itertools.count(2)
        req_id = next(rpc_request._id_counter)
        body = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "mcp-session-id": session_id,
        }
        try:
            conn.request("POST", parsed.path or "/mcp", body=json.dumps(body).encode(), headers=headers)
            resp = conn.getresponse()
            data = resp.read().decode(errors="ignore")
            # try to parse SSE responses similarly to rpc_call
            content_type = (resp.getheader("Content-Type") or "").lower()
            if content_type.startswith("application/json"):
                return json.loads(data)
            if "data:" in data:
                for line in data.splitlines():
                    if line.strip().startswith("data:"):
                        try:
                            return json.loads(line.split("data:", 1)[1].strip())
                        except Exception:
                            continue
            try:
                return json.loads(data)
            except Exception:
                return {"raw": data}
        finally:
            try:
                conn.close()
            except Exception:
                pass


    tools_resp = rpc_request(session_id, "tools/list")
    print("[rpc] tools/list response:", json.dumps(tools_resp, indent=2))
    tools = None
    try:
        tools = tools_resp.get("result", {}).get("tools")
    except Exception:
        tools = None

    if tools and isinstance(tools, list):
        # find a tool related to chat-history
        candidate = None
        for tool_entry in tools:
            name = tool_entry.get("name") or tool_entry.get("tool") or tool_entry.get("id")
            if not name:
                continue
            if "chat-history" in name or name.startswith("chat-history") or "chat-history-sshfs" in name:
                candidate = name
                break
        if candidate:
            print(f"[rpc] calling tools/call for tool {candidate}")
            call_resp = rpc_request(session_id, "tools/call", {"name": candidate, "arguments": {}})
            try:
                # If the tool wrapped an error, it may present result.isError and content
                if isinstance(call_resp, dict) and call_resp.get("result", {}).get("isError"):
                    print("[rpc] tools/call reported tool-level error:")
                    print(json.dumps(call_resp.get("result", {}), indent=2))
                else:
                    print("[rpc] tools/call response:", json.dumps(call_resp, indent=2))
            except Exception:
                print("[rpc] tools/call raw response:", repr(call_resp))

            # If the tool we called was the chat-stores tool, try to list sessions
            try:
                if isinstance(call_resp, dict) and call_resp.get("result", {}).get("structuredContent"):
                    stores = call_resp.get("result", {}).get("structuredContent", {}).get("result")
                else:
                    # fallback: try parsing structuredContent from the earlier tools/list response
                    stores = tools_resp.get("result", {}).get("structuredContent", {}).get("result")
            except Exception:
                stores = None

            if stores and isinstance(stores, list):
                # prefer a workspace store with an id-like name (contains a dash),
                # otherwise pick the first non-profile store
                chosen = None
                for s in stores:
                    store_id = s.get("store_id") or ""
                    if store_id.startswith("workspace:") and ("-" in store_id or len(store_id) > 20):
                        chosen = s
                        break
                if chosen is None:
                    for s in stores:
                        if s.get("store_id") and not s.get("store_id").startswith("profile"):
                            chosen = s
                            break
                if chosen is None and stores:
                    chosen = stores[0]

                if chosen:
                    # Try stores in order (preferred chosen one first) until we successfully list/load a session.
                    ordered = [chosen] + [s for s in stores if s is not chosen]
                    sessions_tool = candidate.replace("_list_chat_stores", "_list_chat_sessions")
                    load_tool = candidate.replace("_list_chat_stores", "_load_chat_session")
                    success = False
                    for s in ordered:
                        store_id = s.get("store_id")
                        if not store_id:
                            continue
                        print(f"[rpc] trying store_id={store_id}")
                        sess_resp = rpc_request(session_id, "tools/call", {"name": sessions_tool, "arguments": {"store_id": store_id}})
                        print("[rpc] list_chat_sessions response:", json.dumps(sess_resp, indent=2))
                        # If the tool reported an error, skip to next store
                        if isinstance(sess_resp, dict) and sess_resp.get("result", {}).get("isError"):
                            continue

                        # parse sessions list
                        sess_list = None
                        try:
                            sess_list = sess_resp.get("result", {}).get("result")
                        except Exception:
                            sess_list = None

                        to_load = None
                        if sess_list and isinstance(sess_list, list) and len(sess_list) > 0:
                            to_load = sess_list[0].get("session_id") or sess_list[0].get("id")
                        else:
                            to_load = "workspace-chunks"

                        print(f"[rpc] calling load tool {load_tool} for session_id={to_load} in store {store_id}")
                        load_resp = rpc_request(session_id, "tools/call", {"name": load_tool, "arguments": {"store_id": store_id, "session_id": to_load}})
                        print("[rpc] load_chat_session response:", json.dumps(load_resp, indent=2)[:4000])

                        # consider success if load_resp is not an error
                        if not (isinstance(load_resp, dict) and load_resp.get("result", {}).get("isError")):
                            success = True
                            break

                    if not success:
                        print("[rpc] no usable sessions found in any store")
        else:
            print("[rpc] no chat-history tool found in tools list")
    else:
        print("[rpc] tools/list returned unexpected result")

    # stop stream
    stop_event.set()
    t.join(timeout=2)


if __name__ == "__main__":
    main()
