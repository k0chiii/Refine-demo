FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.py /app/server.py
USER 65534:65534
EXPOSE 8080
CMD ["python3", "/app/server.py"]
