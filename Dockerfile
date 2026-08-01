# WRAITH — browser hook lab. Small, single-process Node image.
FROM node:20-alpine

# tini for correct signal handling so SIGTERM flushes the session store on stop.
RUN apk add --no-cache tini

WORKDIR /app

# Install production deps first so the layer caches across source edits.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source (node_modules, .env, data/ are excluded via .dockerignore).
COPY . .

# Session store lives here; also declared a volume so loot persists across
# container restarts and never bakes into the image.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

# Drop root inside the container.
USER node

# Informational; the real port comes from WRAITH_PORT at runtime.
EXPOSE 8090

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
