"""SSH connection manager for remote filesystem operations."""

import asyncio
from pathlib import Path, PurePosixPath
from typing import Optional, List
import asyncssh
from asyncssh import SFTPClient


class SSHConnectionManager:
    """Manages SSH connection and SFTP operations."""

    def __init__(
        self,
        host: str,
        username: str,
        port: int = 22,
        key_path: Optional[str] = None,
    ):
        """
        Initialize SSH connection manager.
        
        Args:
            host: SSH server hostname or IP
            username: SSH username
            port: SSH port (default 22)
            key_path: Path to SSH private key file
        """
        self.host = host
        self.username = username
        self.port = port
        self.key_path = key_path or str(Path.home() / ".ssh" / "id_rsa")
        self._connection: Optional[asyncssh.SSHClientConnection] = None
        self._sftp: Optional[SFTPClient] = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        """Establish SSH connection."""
        async with self._lock:
            if self._connection is None or self._connection.is_closed():
                try:
                    # Expand user path for key
                    key_path = Path(self.key_path).expanduser()
                    
                    # Load keypair without certificates
                    from asyncssh.public_key import load_keypairs
                    client_keys = load_keypairs(str(key_path))
                    
                    self._connection = await asyncssh.connect(
                        self.host,
                        port=self.port,
                        username=self.username,
                        client_keys=client_keys,
                        known_hosts=None,  # Accept any host key (consider security implications)
                    )
                    self._sftp = await self._connection.start_sftp_client()
                except Exception as e:
                    raise ConnectionError(
                        f"Failed to connect to {self.username}@{self.host}:{self.port}: {e}"
                    )

    async def disconnect(self) -> None:
        """Close SSH connection."""
        async with self._lock:
            if self._sftp:
                self._sftp.exit()
                self._sftp = None
            if self._connection:
                self._connection.close()
                await self._connection.wait_closed()
                self._connection = None

    async def ensure_connected(self) -> SFTPClient:
        """Ensure connection is active and return SFTP client."""
        if self._sftp is None or self._connection is None or self._connection.is_closed():
            await self.connect()
        return self._sftp

    async def read_file(self, path: str) -> bytes:
        """Read file contents."""
        sftp = await self.ensure_connected()
        try:
            async with sftp.open(path, 'rb') as f:
                return await f.read()
        except Exception as e:
            raise FileNotFoundError(f"Failed to read file {path}: {e}")

    async def write_file(self, path: str, content: bytes) -> None:
        """Write file contents."""
        sftp = await self.ensure_connected()
        try:
            # Ensure parent directory exists
            parent = str(PurePosixPath(path).parent)
            if parent != '/':
                await self.ensure_directory_exists(parent)
            
            async with sftp.open(path, 'wb') as f:
                await f.write(content)
        except Exception as e:
            raise IOError(f"Failed to write file {path}: {e}")

    async def list_directory(self, path: str) -> List[dict]:
        """List directory contents."""
        sftp = await self.ensure_connected()
        try:
            entries = []
            async for entry in sftp.scandir(path):
                stat = entry.attrs
                entries.append({
                    'name': entry.filename,
                    'type': 'directory' if stat.type == asyncssh.FILEXFER_TYPE_DIRECTORY else 'file',
                    'size': stat.size or 0,
                    'mtime': stat.mtime or 0,
                })
            return entries
        except Exception as e:
            raise FileNotFoundError(f"Failed to list directory {path}: {e}")

    async def create_directory(self, path: str) -> None:
        """Create directory (with parents)."""
        sftp = await self.ensure_connected()
        try:
            await sftp.makedirs(path, exist_ok=True)
        except Exception as e:
            raise IOError(f"Failed to create directory {path}: {e}")

    async def ensure_directory_exists(self, path: str) -> None:
        """Ensure directory exists."""
        sftp = await self.ensure_connected()
        try:
            await sftp.stat(path)
        except:
            await self.create_directory(path)

    async def move_file(self, source: str, destination: str) -> None:
        """Move/rename file or directory."""
        sftp = await self.ensure_connected()
        try:
            await sftp.rename(source, destination)
        except Exception as e:
            raise IOError(f"Failed to move {source} to {destination}: {e}")

    async def get_file_info(self, path: str) -> dict:
        """Get file/directory metadata."""
        sftp = await self.ensure_connected()
        try:
            stat = await sftp.stat(path)
            return {
                'size': stat.size,
                'type': 'directory' if stat.type == asyncssh.FILEXFER_TYPE_DIRECTORY else 'file',
                'mtime': stat.mtime,
                'atime': stat.atime,
                'permissions': oct(stat.permissions) if stat.permissions else None,
            }
        except Exception as e:
            raise FileNotFoundError(f"Failed to get info for {path}: {e}")

    async def search_files(self, path: str, pattern: str, max_depth: int = 3) -> List[str]:
        """Search for files matching pattern in directory tree."""
        import fnmatch
        
        sftp = await self.ensure_connected()
        matches = []
        visited = set()
        
        async def _search_recursive(current_path: str, depth: int = 0):
            if depth > max_depth:
                return
            if current_path in visited:
                return
            visited.add(current_path)
            
            try:
                async for entry in sftp.scandir(current_path):
                    full_path = str(PurePosixPath(current_path) / entry.filename)
                    
                    # Check if filename matches pattern
                    if fnmatch.fnmatch(entry.filename, pattern):
                        matches.append(full_path)
                    
                    # Recurse into directories (but only if within reasonable depth)
                    if entry.attrs.type == asyncssh.FILEXFER_TYPE_DIRECTORY and depth < max_depth:
                        await _search_recursive(full_path, depth + 1)
            except (OSError, PermissionError):
                # Skip directories we can't read
                pass
        
        await _search_recursive(path)
        return matches
