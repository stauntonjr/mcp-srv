"""Path validation and security utilities."""

from pathlib import PurePosixPath
from typing import List


class PathValidator:
    """Validates paths against allowed directories."""

    def __init__(self, allowed_directories: List[str]):
        """
        Initialize path validator.
        
        Args:
            allowed_directories: List of allowed directory paths
        """
        # Normalize all allowed directories to absolute paths
        # PurePosixPath doesn't have resolve(), so we normalize manually
        self.allowed_directories = [
            str(PurePosixPath(d)) for d in allowed_directories
        ]

    def validate_path(self, path: str) -> str:
        """
        Validate that path is within allowed directories.
        
        Args:
            path: Path to validate
            
        Returns:
            Normalized absolute path
            
        Raises:
            ValueError: If path is not within allowed directories
        """
        # Normalize the path (PurePosixPath doesn't have resolve())
        normalized = str(PurePosixPath(path))
        
        # Check if path is within any allowed directory
        for allowed_dir in self.allowed_directories:
            # Check if path is the allowed directory or within it
            if normalized == allowed_dir or normalized.startswith(allowed_dir + '/'):
                return normalized
        
        raise ValueError(
            f"Access denied: Path '{path}' is not within allowed directories. "
            f"Allowed directories: {', '.join(self.allowed_directories)}"
        )

    def get_allowed_directories(self) -> List[str]:
        """Get list of allowed directories."""
        return self.allowed_directories.copy()
