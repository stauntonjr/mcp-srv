"""Allow running the package as a module: python -m mcp_filesystem_sshfs"""

from .server import main

if __name__ == "__main__":
    main()
