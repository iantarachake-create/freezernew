FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=8000
EXPOSE 8000
# mount /app/sessions and /app/data as volumes only if you are NOT using DATABASE_URL / MONGODB_URI
# the host restarts the container if the app stops answering (use with: docker run --restart unless-stopped)
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
