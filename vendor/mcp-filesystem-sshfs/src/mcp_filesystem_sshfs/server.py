"""MCP Filesystem SSHFS Server implementation."""

import argparse
import asyncio
import sys
from typing import Optional
from mcp.server.fastmcp import FastMCP
from .ssh_manager import SSHConnectionManager
from .path_validator import PathValidator


# Global instances
ssh_manager: Optional[SSHConnectionManager] = None
path_validator: Optional[PathValidator] = None

# Create MCP server
mcp = FastMCP("filesystem-sshfs")


@mcp.tool()
async def read_text_file(path: str) -> str:
    """
    Read complete contents of a text file from remote server.
    
    Args:
        path: Path to the file on the remote server
        
    Returns:
        File contents as text
    """
    validated_path = path_validator.validate_path(path)
    content_bytes = await ssh_manager.read_file(validated_path)
    try:
        return content_bytes.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError(f"File {path} is not a valid UTF-8 text file")


@mcp.tool()
async def write_file(path: str, content: str) -> str:
    """
    Create or overwrite a file on the remote server.
    
    Args:
        path: Path to the file on the remote server
        content: Text content to write
        
    Returns:
        Success message
    """
    validated_path = path_validator.validate_path(path)
    content_bytes = content.encode('utf-8')
    await ssh_manager.write_file(validated_path, content_bytes)
    return f"Successfully wrote {len(content_bytes)} bytes to {path}"


@mcp.tool()
async def list_directory(path: str) -> str:
    """
    List contents of a directory on the remote server.
    
    Args:
        path: Path to the directory on the remote server
        
    Returns:
        Formatted directory listing
    """
    validated_path = path_validator.validate_path(path)
    entries = await ssh_manager.list_directory(validated_path)
    
    # Format output similar to the original filesystem server
    lines = []
    for entry in sorted(entries, key=lambda e: (e['type'] != 'directory', e['name'])):
        prefix = "[DIR]" if entry['type'] == 'directory' else "[FILE]"
        lines.append(f"{prefix} {entry['name']}")
    
    return "\n".join(lines) if lines else "Empty directory"


@mcp.tool()
async def create_directory(path: str) -> str:
    """
    Create a directory on the remote server (creates parent directories as needed).
    
    Args:
        path: Path to the directory to create on the remote server
        
    Returns:
        Success message
    """
    validated_path = path_validator.validate_path(path)
    await ssh_manager.create_directory(validated_path)
    return f"Successfully created directory {path}"


@mcp.tool()
async def move_file(source: str, destination: str) -> str:
    """
    Move or rename a file or directory on the remote server.
    
    Args:
        source: Current path of the file/directory on the remote server
        destination: New path for the file/directory on the remote server
        
    Returns:
        Success message
    """
    validated_source = path_validator.validate_path(source)
    validated_destination = path_validator.validate_path(destination)
    await ssh_manager.move_file(validated_source, validated_destination)
    return f"Successfully moved {source} to {destination}"


@mcp.tool()
async def search_files(path: str, pattern: str) -> str:
    """
    Search for files matching a pattern in a directory tree on the remote server.
    
    Args:
        path: Directory path to search in on the remote server
        pattern: File name pattern (supports wildcards like *.txt)
        
    Returns:
        List of matching file paths
    """
    validated_path = path_validator.validate_path(path)
    matches = await ssh_manager.search_files(validated_path, pattern)
    
    if not matches:
        return f"No files matching '{pattern}' found in {path}"
    
    return "\n".join(matches)


@mcp.tool()
async def get_file_info(path: str) -> str:
    """
    Get detailed metadata about a file or directory on the remote server.
    
    Args:
        path: Path to the file/directory on the remote server
        
    Returns:
        Formatted metadata information
    """
    validated_path = path_validator.validate_path(path)
    info = await ssh_manager.get_file_info(validated_path)
    
    lines = [
        f"Path: {path}",
        f"Type: {info['type']}",
        f"Size: {info['size']} bytes",
    ]
    
    if info.get('mtime'):
        from datetime import datetime
        mtime = datetime.fromtimestamp(info['mtime'])
        lines.append(f"Modified: {mtime.isoformat()}")
    
    if info.get('atime'):
        from datetime import datetime
        atime = datetime.fromtimestamp(info['atime'])
        lines.append(f"Accessed: {atime.isoformat()}")
    
    if info.get('permissions'):
        lines.append(f"Permissions: {info['permissions']}")
    
    return "\n".join(lines)


@mcp.tool()
async def list_allowed_directories() -> str:
    """
    List all directories that this server is allowed to access on the remote server.
    
    Returns:
        List of allowed directory paths
    """
    directories = path_validator.get_allowed_directories()
    return "\n".join(directories)


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="MCP Filesystem SSHFS Server - Remote filesystem operations over SSH"
    )
    parser.add_argument(
        "--host",
        required=True,
        help="SSH server hostname or IP address"
    )
    parser.add_argument(
        "--username",
        required=True,
        help="SSH username"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=22,
        help="SSH port (default: 22)"
    )
    parser.add_argument(
        "--key-path",
        help="Path to SSH private key file (default: ~/.ssh/id_rsa)"
    )
    parser.add_argument(
        "--allowed-dirs",
        required=True,
        help="Comma-separated list of allowed directories on remote server"
    )
    
    return parser.parse_args()


def main():
    """Main entry point for the MCP server."""
    global ssh_manager, path_validator
    
    # Parse command line arguments
    args = parse_args()
    
    # Parse allowed directories
    allowed_dirs = [d.strip() for d in args.allowed_dirs.split(',') if d.strip()]
    
    if not allowed_dirs:
        print("Error: At least one allowed directory must be specified", file=sys.stderr)
        sys.exit(1)
    
    # Initialize global instances
    ssh_manager = SSHConnectionManager(
        host=args.host,
        username=args.username,
        port=args.port,
        key_path=args.key_path,
    )
    
    path_validator = PathValidator(allowed_dirs)
    
    # Run the MCP server
    mcp.run()


if __name__ == "__main__":
    main()
