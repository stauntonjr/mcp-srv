"""Utilities for accessing VS Code chat history over SSH."""

from __future__ import annotations

import json
import re
import sqlite3
import tempfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Dict, List, Optional, Union

from ..path_validator import PathValidator
from ..ssh_manager import SSHConnectionManager


@dataclass
class ChatStore:
    """Represents a VS Code chat storage location.

    state_db_path may be None for stores that do not use the VS Code state DB
    layout (for example: external Markdown-based chat exports).
    """

    store_id: str
    scope: str  # "profile" or "workspace"
    state_db_path: Optional[str]
    chat_dir_path: str
    label: str
    workspace_metadata: Optional[Dict[str, Any]] = None


@dataclass
class ChatSessionSummary:
    """Metadata describing a chat session."""

    session_id: str
    title: str
    last_message_date: Optional[int]
    is_imported: Optional[bool]
    source: str  # "file" or "sqlite"


class ChatStorageError(Exception):
    """Raised when chat storage data cannot be accessed."""


class ChatStorageHelper:
    """Helper for reading VS Code chat data via SSH."""

    def __init__(
        self,
        ssh_manager: SSHConnectionManager,
        profile_storage_path: str,
        workspace_storage_root: Optional[str] = None,
        path_validator: Optional[PathValidator] = None,
    ) -> None:
        self._ssh_manager = ssh_manager
        self._profile_storage_path = str(PurePosixPath(profile_storage_path))
        self._workspace_storage_root = (
            str(PurePosixPath(workspace_storage_root)) if workspace_storage_root else None
        )
        self._validator = path_validator

    async def list_stores(self) -> List[ChatStore]:
        """Enumerate available chat storage locations."""

        stores: List[ChatStore] = []

        profile_state = self._validate_path(
            str(PurePosixPath(self._profile_storage_path) / "state.vscdb")
        )
        profile_chat_dir = self._validate_path(
            str(PurePosixPath(self._profile_storage_path) / "chatSessions")
        )
        stores.append(
            ChatStore(
                store_id="profile",
                scope="profile",
                state_db_path=profile_state,
                chat_dir_path=profile_chat_dir,
                label="Profile (global)",
            )
        )

        if self._workspace_storage_root:
            workspace_root = PurePosixPath(self._validate_path(self._workspace_storage_root))
            try:
                entries = await self._ssh_manager.list_directory(str(workspace_root))
            except Exception as exc:  # pragma: no cover - surfaced later
                raise ChatStorageError(
                    f"Failed to list workspace storage at {workspace_root}: {exc}"
                ) from exc

            for entry in entries:
                if entry.get("type") != "directory":
                    continue
                workspace_folder = workspace_root / entry["name"]
                state_path = self._validate_path(str(workspace_folder / "state.vscdb"))
                chat_dir = self._validate_path(str(workspace_folder / "chatSessions"))
                label = entry["name"]
                metadata = await self._read_workspace_metadata(workspace_folder)
                if metadata:
                    folder = metadata.get("folder") or metadata.get("folderUri")
                    if isinstance(folder, dict):
                        label = folder.get("name", label)
                    elif isinstance(folder, str):
                        label = folder

                stores.append(
                    ChatStore(
                        store_id=f"workspace:{entry['name']}",
                        scope="workspace",
                        state_db_path=state_path,
                        chat_dir_path=chat_dir,
                        label=label,
                        workspace_metadata=metadata,
                    )
                )

        return stores

    async def list_sessions(self, store: ChatStore) -> List[ChatSessionSummary]:
        """List persisted chat sessions for a store."""

        summaries: Dict[str, ChatSessionSummary] = {}

        # If a store id string was passed, resolve it to a ChatStore
        if isinstance(store, str):
            store = await self._resolve_store_id(store)

        # Load metadata from file storage index. If the state DB cannot be
        # read, treat it as absent and continue to legacy/heuristic fallbacks.
        try:
            if store.state_db_path:
                index = await self._load_index_from_sqlite(store.state_db_path)
                entries = index.get("entries", {}) if isinstance(index, dict) else {}
            else:
                entries = {}
        except ChatStorageError:
            entries = {}
        for session_id, metadata in entries.items():
            title = metadata.get("title") or "New Chat"
            summaries[session_id] = ChatSessionSummary(
                session_id=session_id,
                title=title,
                last_message_date=metadata.get("lastMessageDate"),
                is_imported=metadata.get("isImported"),
                source="file",
            )

        # Include legacy sessions stored directly in sqlite
        legacy_sessions = await self._load_legacy_sessions(store.state_db_path)
        for session in legacy_sessions:
            session_id = session.get("sessionId")
            if not session_id:
                continue
            if session_id in summaries:
                continue
            summaries[session_id] = ChatSessionSummary(
                session_id=session_id,
                title=session.get("customTitle")
                or _default_title_from_requests(session.get("requests", [])),
                last_message_date=session.get("lastMessageDate"),
                is_imported=session.get("isImported"),
                source="sqlite",
            )

        # If no sessions were found, try the Copilot workspace-chunks DB as a fallback
        if not summaries:
            # discover all workspace-chunks DBs under workspace_storage_root and
            # expose one synthetic session per discovered DB. If only a single
            # DB is present, also expose the legacy id "workspace-chunks" for
            # backward compatibility.
            try:
                dbs = await self._find_all_workspace_chunks_dbs()
            except Exception:
                dbs = []

            if dbs:
                for name, _ in dbs:
                    sid = f"workspace-chunks:{name}"
                    summaries[sid] = ChatSessionSummary(
                        session_id=sid,
                        title=f"Copilot workspace cache ({name})",
                        last_message_date=None,
                        is_imported=None,
                        source="workspace-chunks",
                    )
                # legacy alias for a single DB
                if len(dbs) == 1:
                    summaries["workspace-chunks"] = ChatSessionSummary(
                        session_id="workspace-chunks",
                        title=f"Copilot workspace cache ({dbs[0][0]})",
                        last_message_date=None,
                        is_imported=None,
                        source="workspace-chunks",
                    )

        # Also support simple Markdown-backed sessions (SpecStory exports etc.)
        try:
            md_summaries = await self._list_markdown_sessions(store.chat_dir_path)
            for s in md_summaries:
                if s.session_id not in summaries:
                    summaries[s.session_id] = s
        except Exception:
            # If listing markdown sessions fails, ignore and return whatever we have
            pass

        return sorted(summaries.values(), key=lambda s: s.last_message_date or 0, reverse=True)

    async def _list_markdown_sessions(self, chat_dir: str) -> List[ChatSessionSummary]:
        """Enumerate simple Markdown-backed sessions stored as individual .md files.

        This supports SpecStory/other tools which export chat transcripts to a
        directory as Markdown files. Each filename (without .md) becomes a
        session id and the first non-empty line of the file is used as the
        session title when available.
        """
        results: List[ChatSessionSummary] = []
        try:
            entries = await self._ssh_manager.list_directory(chat_dir)
        except Exception:
            return results

        for entry in entries:
            if entry.get("type") != "file":
                continue
            name = entry.get("name", "")
            if not name.lower().endswith(".md"):
                continue
            session_id = name[:-3]
            title = name
            # Attempt to read the file to extract a first-line title
            try:
                data = await self._ssh_manager.read_file(str(PurePosixPath(chat_dir) / name))
                if data:
                    text = data.decode("utf-8", errors="ignore")
                    for line in text.splitlines():
                        stripped = line.strip()
                        if not stripped:
                            continue
                        # Use header-style first line if present (# Title)
                        if stripped.startswith("#"):
                            title = stripped.lstrip("#").strip()
                        else:
                            title = stripped
                        break
            except Exception:
                pass

            results.append(
                ChatSessionSummary(
                    session_id=session_id,
                    title=title,
                    last_message_date=None,
                    is_imported=None,
                    source="markdown",
                )
            )
        # Sort by name (could be timestamped filenames)
        return sorted(results, key=lambda s: s.title or s.session_id, reverse=False)
        

    async def _detect_workspace_chunks_db(self, state_db_path: str) -> Optional[bytes]:
        """Detect and return bytes of workspace-chunks.db when present next to a workspace state DB.

        This is a heuristic fallback for Copilot/VS Code installations that store cached
        data in `GitHub.copilot-chat/workspace-chunks.db` instead of the older
        `state.vscdb` + `chatSessions` layout.
        """
        try:
            state_path = PurePosixPath(state_db_path)
            candidate = state_path.parent / "GitHub.copilot-chat" / "workspace-chunks.db"
            data = await self._ssh_manager.read_file(str(candidate))
            if data:
                return data
        except Exception:
            # fall through to broader search
            pass

        # If the exact sibling candidate wasn't found, try scanning the configured
        # workspace storage root (if available) for any workspace that contains
        # a GitHub.copilot-chat/workspace-chunks.db file. This helps when the
        # workspace folder name differs from the provided state_db_path parent.
        if self._workspace_storage_root:
            try:
                root = PurePosixPath(self._workspace_storage_root)
                entries = await self._ssh_manager.list_directory(str(root))
                for entry in entries:
                    if entry.get("type") != "directory":
                        continue
                    cand = root / entry["name"] / "GitHub.copilot-chat" / "workspace-chunks.db"
                    try:
                        data = await self._ssh_manager.read_file(str(cand))
                        if data:
                            return data
                    except Exception:
                        continue
            except Exception:
                pass

        return None

    async def _find_all_workspace_chunks_dbs(self) -> List[tuple]:
        """Scan the configured workspace storage root and return a list of
        (workspace_folder_name, db_bytes) tuples for every GitHub.copilot-chat/workspace-chunks.db
        that can be read.

        This is used to expose one synthetic session per discovered Copilot DB.
        """
        results: List[tuple] = []
        if not self._workspace_storage_root:
            return results

        try:
            root = PurePosixPath(self._workspace_storage_root)
            entries = await self._ssh_manager.list_directory(str(root))
        except Exception:
            return results

        for entry in entries:
            if entry.get("type") != "directory":
                continue
            cand = root / entry["name"] / "GitHub.copilot-chat" / "workspace-chunks.db"
            try:
                data = await self._ssh_manager.read_file(str(cand))
                if data:
                    results.append((entry["name"], data))
            except Exception:
                continue

        return results

    async def _resolve_store_id(self, store_id: str) -> ChatStore:
        """Resolve a store identifier (possibly coming from MCP) to a ChatStore.

        This implements heuristics to map MCP-reported store ids to workspaceStorage
        folder names. If the store cannot be resolved to an existing workspace
        folder, but a Copilot `workspace-chunks.db` is found anywhere under the
        configured `workspace_storage_root`, a synthetic ChatStore is returned
        which preserves the requested `store_id` but points to the discovered
        workspace folder so session listing/loading can continue.
        """
        # quick special-cases
        if store_id == "profile":
            profile_state = self._validate_path(
                str(PurePosixPath(self._profile_storage_path) / "state.vscdb")
            )
            profile_chat_dir = self._validate_path(
                str(PurePosixPath(self._profile_storage_path) / "chatSessions")
            )
            return ChatStore(
                store_id="profile",
                scope="profile",
                state_db_path=profile_state,
                chat_dir_path=profile_chat_dir,
                label="Profile (global)",
            )

        # If the caller passed an already-scoped id like "workspace:NAME", try to
        # match NAME to a workspaceStorage folder name. Otherwise, try matching
        # by substring.
        if store_id.startswith("workspace:"):
            candidate = store_id.split("workspace:", 1)[1]
        else:
            candidate = store_id

        if self._workspace_storage_root:
            root = PurePosixPath(self._workspace_storage_root)
            try:
                entries = await self._ssh_manager.list_directory(str(root))
            except Exception:
                entries = []

            # exact match first
            for entry in entries:
                if entry.get("type") != "directory":
                    continue
                if entry.get("name") == candidate:
                    workspace_folder = root / entry["name"]
                    state_path = self._validate_path(str(workspace_folder / "state.vscdb"))
                    chat_dir = self._validate_path(str(workspace_folder / "chatSessions"))
                    metadata = await self._read_workspace_metadata(workspace_folder)
                    label = entry["name"]
                    if metadata:
                        folder = metadata.get("folder") or metadata.get("folderUri")
                        if isinstance(folder, dict):
                            label = folder.get("name", label)
                        elif isinstance(folder, str):
                            label = folder
                    return ChatStore(
                        store_id=store_id,
                        scope="workspace",
                        state_db_path=state_path,
                        chat_dir_path=chat_dir,
                        label=label,
                        workspace_metadata=metadata,
                    )

            # substring/contains match
            for entry in entries:
                if entry.get("type") != "directory":
                    continue
                if candidate in entry.get("name", ""):
                    workspace_folder = root / entry["name"]
                    state_path = self._validate_path(str(workspace_folder / "state.vscdb"))
                    chat_dir = self._validate_path(str(workspace_folder / "chatSessions"))
                    metadata = await self._read_workspace_metadata(workspace_folder)
                    label = entry["name"]
                    if metadata:
                        folder = metadata.get("folder") or metadata.get("folderUri")
                        if isinstance(folder, dict):
                            label = folder.get("name", label)
                        elif isinstance(folder, str):
                            label = folder
                    return ChatStore(
                        store_id=store_id,
                        scope="workspace",
                        state_db_path=state_path,
                        chat_dir_path=chat_dir,
                        label=label,
                        workspace_metadata=metadata,
                    )

            # Finally, if no folder name matched, try to find any workspace that
            # contains a GitHub.copilot-chat/workspace-chunks.db and return that as
            # a synthetic mapping for the provided store_id. This lets MCP callers
            # request their original store id and still receive Copilot data when
            # folder names don't align with MCP's identifiers.
            for entry in entries:
                if entry.get("type") != "directory":
                    continue
                cand = root / entry["name"] / "GitHub.copilot-chat" / "workspace-chunks.db"
                try:
                    data = await self._ssh_manager.read_file(str(cand))
                    if data:
                        workspace_folder = root / entry["name"]
                        state_path = self._validate_path(str(workspace_folder / "state.vscdb"))
                        chat_dir = self._validate_path(str(workspace_folder / "chatSessions"))
                        metadata = await self._read_workspace_metadata(workspace_folder)
                        label = entry["name"]
                        if metadata:
                            folder = metadata.get("folder") or metadata.get("folderUri")
                            if isinstance(folder, dict):
                                label = folder.get("name", label)
                            elif isinstance(folder, str):
                                label = folder
                        return ChatStore(
                            store_id=store_id,
                            scope="workspace",
                            state_db_path=state_path,
                            chat_dir_path=chat_dir,
                            label=label,
                            workspace_metadata=metadata,
                        )
                except Exception:
                    continue

        raise ChatStorageError(f"Unable to resolve store id {store_id}")

    async def load_session(self, store: Union[ChatStore, str], session_id: str) -> Dict[str, Any]:
        """Load a full chat session transcript."""
        # Accept either a ChatStore or a store id string and resolve accordingly
        if isinstance(store, str):
            store = await self._resolve_store_id(store)

        # Special-case: workspace-chunks synthetic sessions (possibly suffixed with
        # a workspace folder name, e.g. "workspace-chunks:0a2514...")
        if session_id.startswith("workspace-chunks"):
            # If the session names a specific workspace folder, read that DB.
            if ":" in session_id:
                _, folder = session_id.split(":", 1)
                if not self._workspace_storage_root:
                    raise ChatStorageError(
                        "No workspace storage root is configured to locate workspace-chunks DBs"
                    )
                cand = PurePosixPath(self._workspace_storage_root) / folder / "GitHub.copilot-chat" / "workspace-chunks.db"
                try:
                    db_bytes = await self._ssh_manager.read_file(str(cand))
                except Exception as exc:
                    raise ChatStorageError(f"workspace-chunks DB for folder {folder} not found: {exc}")
            else:
                # legacy/unsuffixed id: try the sibling detection first, then fall
                # back to the first discovered DB under workspace_storage_root.
                db_bytes = await self._detect_workspace_chunks_db(store.state_db_path)
                if not db_bytes:
                    dbs = await self._find_all_workspace_chunks_dbs()
                    db_bytes = dbs[0][1] if dbs else None

            if db_bytes:
                # Extract some useful text from the chunks DB
                with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
                    tmp.write(db_bytes)
                    tmp.flush()
                    try:
                        with sqlite3.connect(tmp.name) as conn:
                            cursor = conn.execute(
                                "SELECT Files.uri, GROUP_CONCAT(FileChunks.text, '') as text "
                                "FROM Files JOIN FileChunks ON Files.id = FileChunks.fileId "
                                "GROUP BY Files.id ORDER BY Files.id LIMIT 200"
                            )
                            messages = []
                            for row in cursor:
                                uri, text = row
                                if not text:
                                    continue
                                messages.append({"uri": uri, "text": text})
                            return {"session_id": session_id, "messages": messages}
                    except Exception as exc:
                        raise ChatStorageError(f"Failed to extract workspace chunks: {exc}")

            raise ChatStorageError(f"workspace-chunks session {session_id} not found")

        # Check for a simple Markdown-backed session file (SpecStory exports)
        try:
            md_path = self._validate_path(str(PurePosixPath(store.chat_dir_path) / f"{session_id}.md"))
            try:
                data = await self._ssh_manager.read_file(md_path)
                if data:
                    text = data.decode("utf-8", errors="ignore")
                    # Wrap the whole markdown as a single assistant message so exporter can render it
                    return {"sessionId": session_id, "messages": [{"role": "assistant", "text": text}]}
            except Exception:
                # not present or unreadable; fall through
                pass
        except Exception:
            # path validation failed or chat_dir not defined; ignore and continue
            pass

        # Normal path: try reading a persisted JSON session file first
        session_path = self._validate_path(
            str(PurePosixPath(store.chat_dir_path) / f"{session_id}.json")
        )
        try:
            data = await self._ssh_manager.read_file(session_path)
            return json.loads(data.decode("utf-8"))
        except Exception:
            # Fall back to legacy sqlite data
            legacy_sessions = await self._load_legacy_sessions(store.state_db_path)
            for session in legacy_sessions:
                if session.get("sessionId") == session_id:
                    return session

            raise ChatStorageError(
                f"Session {session_id} not found in store {store.store_id}"
            )

    def _validate_path(self, path: Optional[str]) -> str:
        if path is None:
            raise ChatStorageError("Path is not defined")
        if self._validator:
            return self._validator.validate_path(path)
        return path

    async def _read_workspace_metadata(self, workspace_folder: PurePosixPath) -> Optional[Dict[str, Any]]:
        metadata_path = self._validate_path(str(workspace_folder / "workspace.json"))
        try:
            data = await self._ssh_manager.read_file(metadata_path)
        except Exception:
            return None

        try:
            return json.loads(data.decode("utf-8"))
        except json.JSONDecodeError:
            return None

    async def _load_index_from_sqlite(self, state_db_path: str) -> Dict[str, Any]:
        path = self._validate_path(state_db_path)
        try:
            db_bytes = await self._ssh_manager.read_file(path)
        except Exception as exc:
            raise ChatStorageError(f"Failed to read state database {state_db_path}: {exc}") from exc

        if not db_bytes:
            return {"entries": {}}

        with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
            tmp.write(db_bytes)
            tmp.flush()
            with sqlite3.connect(tmp.name) as conn:
                cursor = conn.execute(
                    "SELECT value FROM ItemTable WHERE key = ?", ("chat.ChatSessionStore.index",)
                )
                row = cursor.fetchone()
                if not row:
                    return {"entries": {}}
                try:
                    return json.loads(row[0])
                except json.JSONDecodeError:
                    return {"entries": {}}

    async def _load_legacy_sessions(self, state_db_path: str) -> List[Dict[str, Any]]:
        path = self._validate_path(state_db_path)
        try:
            db_bytes = await self._ssh_manager.read_file(path)
        except Exception:
            return []

        if not db_bytes:
            return []

        with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
            tmp.write(db_bytes)
            tmp.flush()
            with sqlite3.connect(tmp.name) as conn:
                cursor = conn.execute("SELECT value FROM ItemTable WHERE key = ?", ("interactive.sessions",))
                row = cursor.fetchone()
                if not row:
                    return []
                try:
                    data = json.loads(row[0])
                except json.JSONDecodeError:
                    return []
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return list(data.values())
                return []

    async def list_tables(self, state_db_path: str) -> List[Dict[str, Any]]:
        """Return a list of tables and basic schema info from the state DB.

        Each entry is a dict: {"name": <table_name>, "sql": <create_sql>}.
        """
        path = self._validate_path(state_db_path)
        try:
            db_bytes = await self._ssh_manager.read_file(path)
        except Exception as exc:
            raise ChatStorageError(f"Failed to read state database {state_db_path}: {exc}") from exc

        if not db_bytes:
            return []

        with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
            tmp.write(db_bytes)
            tmp.flush()
            try:
                with sqlite3.connect(tmp.name) as conn:
                    cursor = conn.execute(
                        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                    )
                    results: List[Dict[str, Any]] = []
                    for row in cursor:
                        name, sql = row
                        results.append({"name": name, "sql": sql})
                    return results
            except Exception as exc:
                raise ChatStorageError(f"Failed to list tables from {state_db_path}: {exc}")

    async def query_db(self, state_db_path: str, sql: str, limit: Optional[int] = None) -> Dict[str, Any]:
        """Execute a read-only query against the state DB and return rows.

        Returns {"columns": [..], "rows": [[..], ...]} where each row is a list of values.
        """
        path = self._validate_path(state_db_path)
        # Basic safety: only allow read-only queries. Reject semicolons (no multi-statement)
        if not isinstance(sql, str) or not re.match(r"^\s*(?:SELECT|PRAGMA|EXPLAIN|WITH)\b", sql, flags=re.IGNORECASE):
            raise ChatStorageError("Only read-only SQL queries (SELECT/PRAGMA/EXPLAIN/WITH) are allowed")
        if ";" in sql:
            # Disallow multiple statements; simple safety check
            raise ChatStorageError("SQL with multiple statements is not allowed")
        try:
            db_bytes = await self._ssh_manager.read_file(path)
        except Exception as exc:
            raise ChatStorageError(f"Failed to read state database {state_db_path}: {exc}") from exc

        if not db_bytes:
            raise ChatStorageError(f"State database {state_db_path} is empty or unavailable")

        with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
            tmp.write(db_bytes)
            tmp.flush()
            try:
                with sqlite3.connect(tmp.name) as conn:
                    conn.row_factory = sqlite3.Row
                    cursor = conn.execute(sql)
                    cols = [c[0] for c in cursor.description] if cursor.description else []
                    rows = []
                    count = 0
                    for row in cursor:
                        if limit is not None and count >= limit:
                            break
                        # Normalize values to JSON-serializable types (decode bytes)
                        def _norm(v: Any) -> Any:
                            if isinstance(v, (bytes, bytearray)):
                                try:
                                    return v.decode("utf-8")
                                except Exception:
                                    return repr(v)
                            return v

                        rows.append([_norm(row[col]) for col in cols])
                        count += 1
                    return {"columns": cols, "rows": rows}
            except Exception as exc:
                raise ChatStorageError(f"Failed to execute query on {state_db_path}: {exc}")

        async def search_in_state_db(self, state_db_path: str, term: str, limit: int = 100) -> Dict[str, Any]:
            """Search common chat storage locations for a text term.

            This provides a safe, parameterized search over the ItemTable by
            searching keys and JSON-encoded `value` text for the provided term.
            It intentionally does not accept raw SQL from callers.

            Returns a dict {"columns": [...], "rows": [[...], ...]} where each
            row is [key, snippet]. `snippet` is a short extract from the value
            showing the matching text when possible.
            """
            path = self._validate_path(state_db_path)
            if not isinstance(term, str) or not term:
                raise ChatStorageError("Search term must be a non-empty string")

            try:
                db_bytes = await self._ssh_manager.read_file(path)
            except Exception as exc:
                raise ChatStorageError(f"Failed to read state database {state_db_path}: {exc}") from exc

            if not db_bytes:
                raise ChatStorageError(f"State database {state_db_path} is empty or unavailable")

            with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
                tmp.write(db_bytes)
                tmp.flush()
                try:
                    with sqlite3.connect(tmp.name) as conn:
                        conn.row_factory = sqlite3.Row
                        # Use parameterized LIKE queries to avoid SQL-injection.
                        like = f"%{term}%"
                        cursor = conn.execute(
                            "SELECT key, value FROM ItemTable WHERE key LIKE ? OR value LIKE ? ORDER BY rowid DESC LIMIT ?",
                            (like, like, limit),
                        )
                        cols = [c[0] for c in cursor.description] if cursor.description else ["key", "value"]
                        rows = []
                        for row in cursor:
                            k = row["key"]
                            v = row["value"]
                            snippet = None
                            if isinstance(v, (bytes, bytearray)):
                                try:
                                    text = v.decode("utf-8", errors="ignore")
                                except Exception:
                                    text = repr(v)
                            else:
                                text = str(v)

                            # produce a short snippet with the match centered when possible
                            idx = text.lower().find(term.lower())
                            if idx >= 0:
                                start = max(0, idx - 80)
                                end = min(len(text), idx + len(term) + 80)
                                snippet = text[start:end].replace("\n", " ")
                            else:
                                snippet = text[:160].replace("\n", " ")

                            rows.append([k, snippet])

                        return {"columns": ["key", "snippet"], "rows": rows}
                except Exception as exc:
                    raise ChatStorageError(f"Failed to execute search on {state_db_path}: {exc}")


def _default_title_from_requests(requests: List[Dict[str, Any]]) -> str:
    if not requests:
        return "New Chat"
    first_request = requests[0]
    if not isinstance(first_request, dict):
        return "New Chat"
    message = first_request.get("message")
    if isinstance(message, dict):
        text = message.get("text")
    else:
        text = None
    if not text:
        return "New Chat"
    return text.splitlines()[0][:80]