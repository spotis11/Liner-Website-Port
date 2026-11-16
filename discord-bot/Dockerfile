# Alfredo Discord bot — headless 24/7 container
# Build:  docker build -t alfredo-bot .
# Run:    docker run -d --name alfredo --restart unless-stopped \
#           -e DISCORD_BOT_TOKEN=your_token_here -p 8080:8080 alfredo-bot
FROM python:3.12-slim

WORKDIR /bot

# ALFREDO_LIGHT: skip cv2/imageio imports (OOM-kill on free-tier lite memory).
# MALLOC_ARENA_MAX: cap glibc arena growth under threaded discord.py + aiohttp.
ENV ALFREDO_LIGHT=1 \
    MALLOC_ARENA_MAX=2

# ffmpeg: audio processing for yt-dlp music commands
# tk8.6: alfredo.py imports tkinter at module level — slim ships the Python
# side but not the libtk8.6/libtcl8.6 shared libs; import works headless.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tk8.6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt alfredo.py run_headless.py ./
# precompile bytecode into the image — exec_module of the 1.9 MB source is
# CPU-bound for minutes on the throttled lite tier otherwise
RUN python3 -m py_compile alfredo.py run_headless.py
RUN pip install --no-cache-dir -r requirements.txt

# the runner is the entrypoint; container-internal supervisor mirrors
# run_forever.sh: crash exits (code 1) restart after a 5s cooldown, a clean
# exit (SIGTERM -> 0, deploys/sleep) lets the container stop.
CMD ["/bin/sh", "-c", "while true; do python3 run_headless.py; c=$?; echo \"[supervisor] runner exited code=$c\"; [ \"$c\" -eq 0 ] && break; sleep 5; done"]
