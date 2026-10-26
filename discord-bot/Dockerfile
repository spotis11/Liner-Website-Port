# Alfredo Discord bot — headless 24/7 container
# Build:  docker build -t alfredo-bot .
# Run:    docker run -d --name alfredo --restart unless-stopped \
#           -e DISCORD_BOT_TOKEN=your_token_here -p 8080:8080 alfredo-bot
FROM python:3.12-slim

WORKDIR /bot

# ffmpeg: audio processing for yt-dlp music commands
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt alfredo.py run_headless.py ./
RUN pip install --no-cache-dir -r requirements.txt

# the runner is the entrypoint; docker's --restart policy is the supervisor
CMD ["python3", "run_headless.py"]
