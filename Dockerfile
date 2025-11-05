FROM local/1mcp:py

# Install Chromium for Playwright
USER root
RUN apk update \
    && apk add --no-cache chromium \
    && rm -rf /var/cache/apk/*

# Ensure Chromium is accessible
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV CHROME_PATH=/usr/lib/chromium/