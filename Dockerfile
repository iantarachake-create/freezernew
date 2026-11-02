FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git openssh-client ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ && git config --global --add url."https://github.com/".insteadOf git@github.com: && git config --global url."https://".insteadOf git://
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error || (echo '=== npm failed, last log ===' && cat /root/.npm/_logs/*.log | tail -60 && exit 1)
COPY . .
ENV NODE_ENV=production PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
