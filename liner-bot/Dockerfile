# Liner System bot — hosted container (running.sh).
# git is required: the commit watcher polls `git fetch origin main` in /app/repo.
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./
EXPOSE 3000
CMD ["node", "index.js"]
