FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Copy pre-compiled output
COPY dist/ ./dist/

# Copy index.js entrypoint
COPY index.js ./

# Create config directory
RUN mkdir -p /app/config

# Expose port
EXPOSE 3000

# Run 1mcp
CMD ["node", "index.js"]
