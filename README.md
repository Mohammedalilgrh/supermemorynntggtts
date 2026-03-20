# TTS API — Piper Arabic + English

A lightweight HTTP API that wraps Piper TTS. Deploy on Render free tier.  
Call it from your n8n workflows to get Arabic and/or English MP3 audio back.

---

## Deploy on Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — click Deploy
5. Wait ~5 mins for first build (downloads voices)
6. Your API will be at: `https://tts-api-xxxx.onrender.com`

---

## Endpoints

### `GET /health`
Check if service is running.
```json
{
  "status": "ok",
  "voices": { "arabic": true, "english": true }
}
```

---

### `POST /tts`
Generic TTS — choose language.

**Body:**
```json
{
  "text": "مرحبا بالعالم",
  "lang": "ar",
  "format": "mp3"
}
```
- `lang`: `ar` (Arabic) or `en` (English) — default `ar`
- `format`: `mp3` or `wav` — default `mp3`

**Returns:** `audio/mpeg` binary

---

### `POST /tts/arabic`
Arabic only shortcut.

**Body:**
```json
{ "text": "اللهم صل على محمد", "format": "mp3" }
```

---

### `POST /tts/english`
English only shortcut.

**Body:**
```json
{ "text": "Hello world", "format": "mp3" }
```

---

### `POST /tts/both`
Generates Arabic + English and merges them into one MP3.  
Arabic plays first, then English.

**Body:**
```json
{
  "arabic": "اللهم صل على محمد",
  "english": "O Allah, send blessings upon Muhammad",
  "format": "mp3"
}
```

**Returns:** merged `audio/mpeg` — Arabic followed by English

---

## Authentication (optional)

Set `API_KEY` env variable in Render dashboard.  
Then pass it in requests:
```
X-API-Key: your-secret-key
```
or
```
Authorization: Bearer your-secret-key
```

---

## Use in n8n

### HTTP Request node settings:

| Field | Value |
|-------|-------|
| Method | POST |
| URL | `https://your-tts-api.onrender.com/tts/both` |
| Body Content Type | JSON |
| Response Format | **File** (important!) |

**Body:**
```json
{
  "arabic": "{{ $('scripts').item.json.script.segments[0].text }}",
  "english": "Hello from n8n"
}
```

The node returns binary audio data you can pipe directly into:
- Upload to R2
- Attach to ffmpeg as `-i audio.mp3`
- Send via Telegram

### Example n8n Code node to call TTS:
```javascript
// Call TTS API and get back binary audio
const response = await this.helpers.request({
  method: 'POST',
  url: 'https://your-tts-api.onrender.com/tts/both',
  headers: { 
    'Content-Type': 'application/json',
    'X-API-Key': 'your-key'  // remove if no API_KEY set
  },
  body: JSON.stringify({
    arabic: 'مرحبا بالعالم',
    english: 'Hello world'
  }),
  encoding: null  // get raw buffer back
});

const binaryData = await this.helpers.prepareBinaryData(
  Buffer.from(response),
  'audio.mp3',
  'audio/mpeg'
);

return [{ json: {}, binary: { audio: binaryData } }];
```

---

## Voices

| Language | Model | Quality |
|----------|-------|---------|
| Arabic | ar_JO-kareem-medium | Best Arabic 2024, Jordanian accent |
| English | en_GB-vctk-medium | UK male, natural |
