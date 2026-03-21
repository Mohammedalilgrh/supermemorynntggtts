FROM n8nio/n8n:latest

USER root

# تثبيت node + edge-tts
RUN npm install -g edge-tts

USER node
