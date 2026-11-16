# Liner web app — prebuilt Next.js standalone bundle on running.sh.
# The bundle is built in the workspace (`npm run build`, which assembles
# .next/standalone per the package.json script) and uploaded; this image only
# RUNS it. Secrets never live in the image — running.sh variables provide them
# at boot (Next.js reads process.env ahead of any .env file).
FROM oven/bun:1-slim
# RUNTIME = bun, matching FC production (`npm start` runs the same standalone
# under bun). Under node:20 the boot OOM-killed (SIGKILL ~145s in, right
# after route loading) on the lite instance tier, which running.sh does not
# let us resize (autoSize-managed, PATCH rejected). bun boots the same bundle
# with a much smaller footprint — proven by FC running this exact artifact.
# (Prisma ships both openssl-1.1/3.0 engines, so either base works.)

WORKDIR /app

COPY standalone/ ./
# ship the current SQLite database so the container boots with real data
# (260 KB); runtime writes stay in the container FS until the next deploy
COPY db/custom.db /app/db/custom.db

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/app/db/custom.db \
    NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000
CMD ["bun", "server.js"]
