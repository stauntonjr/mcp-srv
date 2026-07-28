FROM local/1mcp:py

# Install Chromium for Playwright
USER root
RUN apk update \
    && apk add --no-cache chromium \
    && rm -rf /var/cache/apk/*

# Ensure Chromium is accessible
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV CHROME_PATH=/usr/lib/chromium/

# Copy and install the local mcp-filesystem-sshfs package so chat-history and
# filesystem sshfs tools are available permanently in the image. We copy from
# the build context (parent) into /opt and install with pip.
COPY mcp-filesystem-sshfs /opt/mcp-filesystem-sshfs
# Allow installing into an externally-managed system Python inside the image.
# This mirrors the manual install we did at runtime with --break-system-packages.
RUN python3 -m pip install --no-cache-dir --break-system-packages /opt/mcp-filesystem-sshfs

# Install sqlite and dev headers (Alpine/apk)
RUN apk update \
    && apk add --no-cache sqlite sqlite-dev \
 && rm -rf /var/lib/apt/lists/*