FROM local/1mcp:py

# Install Python 3 and Chromium for Playwright
USER root
RUN apk update \
    && apk add --no-cache python3 py3-pip \
    && rm -rf /var/cache/apk/*

# Install Chromium for Playwright
RUN apk add --no-cache chromium \
    && rm -rf /var/cache/apk/*

# Ensure Chromium is accessible
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV CHROME_PATH=/usr/lib/chromium/

# Copy and install the local mcp-filesystem-sshfs package
COPY vendor/mcp-filesystem-sshfs /opt/mcp-filesystem-sshfs
RUN pip3 install --break-system-packages /opt/mcp-filesystem-sshfs

# Install sqlite and dev headers (Alpine/apk)
RUN apk add --no-cache sqlite sqlite-dev \
 && rm -rf /var/lib/apt/lists/*

# Create memory directory
RUN mkdir -p /stores
