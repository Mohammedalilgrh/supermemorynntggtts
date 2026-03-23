# ── Base image ───────────────────────────────────────────────────────────────
FROM python:3.11-slim

# ── تثبيت الأدوات الأساسية ──────────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    tar \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── إنشاء بيئة افتراضية لتثبيت بايثون ───────────────────────────────────────
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ── تثبيت Piper binary ──────────────────────────────────────────────────────
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"; \
    elif [ "$ARCH" = "aarch64" ]; then \
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz"; \
    else \
        echo "Unsupported arch: $ARCH" && exit 1; \
    fi && \
    wget -q "$PIPER_URL" -O piper.tar.gz && \
    tar -xzf piper.tar.gz && \
    rm piper.tar.gz && \
    chmod +x /app/piper/piper

# ── تحميل أصوات Piper ───────────────────────────────────────────────────────
RUN mkdir -p /app/models

# Arabic - ar_JO-kareem-medium
RUN wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx" \
    -O /app/models/ar_JO-kareem-medium.onnx && \
    wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json" \
    -O /app/models/ar_JO-kareem-medium.onnx.json

# English US Female - en_US-lessac-medium
RUN wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx" \
    -O /app/models/en_US-lessac-medium.onnx && \
    wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" \
    -O /app/models/en_US-lessac-medium.onnx.json

# English US Male - en_US-ryan-medium
RUN wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/medium/en_US-ryan-medium.onnx" \
    -O /app/models/en_US-ryan-medium.onnx && \
    wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json" \
    -O /app/models/en_US-ryan-medium.onnx.json

# ── تثبيت بايثون dependencies داخل البيئة الافتراضية ───────────────────────
COPY requirements.txt .
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# ── نسخ تطبيق FastAPI ───────────────────────────────────────────────────────
COPY main.py .

ENV MODELS_DIR=/app/models
ENV PORT=8000

EXPOSE 8000

# ── تشغيل الخدمة ────────────────────────────────────────────────────────────
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
