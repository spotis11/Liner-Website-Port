# Alfredo Discord bot — Node.js edition (hosted container on running.sh).
# Same image shape as the proven liner-bot Dockerfile, plus the audio stack:
#   ffmpeg   — @discordjs/voice streams (reconnect flags handled in-process)
#   yt-dlp   — fallback stream resolver when InnerTube profiles are refused
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./
COPY lib ./lib
COPY data ./data
EXPOSE 3000
CMD ["node", "index.js"]
