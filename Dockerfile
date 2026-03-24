# ─────────────────────────────────────────────────────
# TTS API Service — Piper + Arabic + English + HTTP API
# ─────────────────────────────────────────────────────
FROM alpine:3.20 AS fetcher

RUN apk add --no-cache curl tar gzip xz ca-certificates

# Download Piper static binary
RUN mkdir -p /toolbox/piper-voices && \
    curl -L --fail --retry 3 \
      https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_amd64.tar.gz \
      -o /tmp/piper.tar.gz && \
    tar -xzf /tmp/piper.tar.gz -C /tmp/ && \
    cp /tmp/piper/piper /toolbox/piper && \
    chmod +x /toolbox/piper && \
    rm -rf /tmp/piper*

# Download FFmpeg static
RUN curl -L --fail \
      https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
      -o /tmp/ffmpeg.tar.xz && \
    tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ && \
    cp /tmp/ffmpeg-*-static/ffmpeg /toolbox/ && \
    chmod +x /toolbox/ffmpeg && \
    rm -rf /tmp/ffmpeg*

# Download Arabic voice (Jordanian — most natural)
RUN curl -fSL --retry 5 --retry-delay 5 \
      -H "User-Agent: TTS-API-Build" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx?download=true" \
      -o /toolbox/piper-voices/ar_JO-kareem-medium.onnx && \
    curl -fSL --retry 5 --retry-delay 5 \
      -H "User-Agent: TTS-API-Build" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json?download=true" \
      -o /toolbox/piper-voices/ar_JO-kareem-medium.onnx.json

# Download English voice (UK male)
RUN curl -fSL --retry 5 --retry-delay 5 \
      -H "User-Agent: TTS-API-Build" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/vctk/medium/en_GB-vctk-medium.onnx?download=true" \
      -o /toolbox/piper-voices/en_GB-vctk-medium.onnx && \
    curl -fSL --retry 5 --retry-delay 5 \
      -H "User-Agent: TTS-API-Build" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/vctk/medium/en_GB-vctk-medium.onnx.json?download=true" \
      -o /toolbox/piper-voices/en_GB-vctk-medium.onnx.json

# ─────────────────────────────────────────────────────
# Final Image — tiny Node.js server
# ─────────────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache \
      fontconfig \
      ttf-dejavu \
      font-noto-arabic \
      fribidi \
      harfbuzz \
      freetype \
      libgcc \
      libstdc++ \
      ca-certificates && \
    fc-cache -fv

# Copy binaries and voices
COPY --from=fetcher /toolbox/piper /usr/local/bin/piper
COPY --from=fetcher /toolbox/ffmpeg /usr/local/bin/ffmpeg
COPY --from=fetcher /toolbox/piper-voices /usr/local/share/piper-voices/

RUN chmod +x /usr/local/bin/piper /usr/local/bin/ffmpeg && \
    ln -sf /usr/local/bin/piper /usr/bin/piper && \
    ln -sf /usr/local/bin/ffmpeg /usr/bin/ffmpeg

WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.js ./

ENV PORT=3000
ENV AR_MODEL=/usr/local/share/piper-voices/ar_JO-kareem-medium.onnx
ENV EN_MODEL=/usr/local/share/piper-voices/en_GB-vctk-medium.onnx

EXPOSE 3000

CMD ["node", "server.js"]
