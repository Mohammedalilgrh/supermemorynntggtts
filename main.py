import os
import io
import subprocess
import tempfile
import base64
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

app = FastAPI(title="Piper TTS Server", version="1.0.0")

# ========== MODELS CONFIG ==========
# Models are downloaded at build time via download_models.sh
MODELS_DIR = os.environ.get("MODELS_DIR", "/app/models")

VOICES = {
    "ar": {
        "model": "ar_JO-kareem-medium.onnx",
        "config": "ar_JO-kareem-medium.onnx.json",
        "desc": "Arabic Male (Jordan)"
    },
    "en": {
        "model": "en_US-lessac-medium.onnx",
        "config": "en_US-lessac-medium.onnx.json",
        "desc": "English US Female"
    },
    "en-male": {
        "model": "en_US-ryan-medium.onnx",
        "config": "en_US-ryan-medium.onnx.json",
        "desc": "English US Male"
    }
}

# ========== MODELS ==========

class TTSRequest(BaseModel):
    text: str
    language: str = "ar"       # ar, en, en-male
    speed: float = 1.0          # 0.5 = slow, 1.0 = normal, 2.0 = fast

class TTSBase64Request(BaseModel):
    text: str
    language: str = "ar"
    speed: float = 1.0

# ========== HELPERS ==========

def get_piper_path():
    """Find piper binary"""
    paths = ["/app/piper/piper", "/usr/local/bin/piper", "piper"]
    for p in paths:
        if os.path.isfile(p):
            return p
    # Try which
    result = subprocess.run(["which", "piper"], capture_output=True, text=True)
    if result.returncode == 0:
        return result.stdout.strip()
    raise RuntimeError("piper binary not found")

def run_piper(text: str, language: str, speed: float) -> bytes:
    """Run piper TTS and return WAV bytes"""
    if language not in VOICES:
        raise HTTPException(status_code=400, detail=f"Unknown language '{language}'. Available: {list(VOICES.keys())}")

    voice = VOICES[language]
    model_path = os.path.join(MODELS_DIR, voice["model"])
    config_path = os.path.join(MODELS_DIR, voice["config"])

    if not os.path.isfile(model_path):
        raise HTTPException(status_code=503, detail=f"Model not found: {voice['model']} — check /health for model status")

    piper = get_piper_path()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        cmd = [
            piper,
            "--model", model_path,
            "--config", config_path,
            "--output_file", tmp_path,
            "--length_scale", str(1.0 / speed),  # length_scale inverse of speed
        ]

        result = subprocess.run(
            cmd,
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=60
        )

        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Piper error: {result.stderr.decode()}")

        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

# ========== ROUTES ==========

@app.get("/")
async def root():
    return {
        "status": "Piper TTS Server running",
        "voices": {k: v["desc"] for k, v in VOICES.items()},
        "endpoints": ["/tts", "/tts-base64", "/health", "/voices"]
    }

@app.get("/health")
async def health():
    models_status = {}
    for lang, voice in VOICES.items():
        model_path = os.path.join(MODELS_DIR, voice["model"])
        models_status[lang] = {
            "model": voice["model"],
            "ready": os.path.isfile(model_path)
        }

    try:
        piper_path = get_piper_path()
        piper_ok = True
    except Exception:
        piper_path = "not found"
        piper_ok = False

    all_ready = piper_ok and all(m["ready"] for m in models_status.values())

    return {
        "status": "ok" if all_ready else "degraded",
        "piper_binary": piper_path,
        "piper_ok": piper_ok,
        "models": models_status
    }

@app.get("/voices")
async def list_voices():
    return {"voices": VOICES}

@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    """Convert text to speech — returns WAV audio file"""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty")
    if len(request.text) > 5000:
        raise HTTPException(status_code=400, detail="text too long (max 5000 chars)")

    wav_bytes = run_piper(request.text, request.language, request.speed)

    return StreamingResponse(
        io.BytesIO(wav_bytes),
        media_type="audio/wav",
        headers={
            "Content-Disposition": "attachment; filename=speech.wav",
            "X-Voice": VOICES[request.language]["desc"],
            "X-Text-Length": str(len(request.text))
        }
    )

@app.post("/tts-base64")
async def tts_base64(request: TTSBase64Request):
    """Convert text to speech — returns base64 WAV inside JSON (easier for n8n)"""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty")
    if len(request.text) > 5000:
        raise HTTPException(status_code=400, detail="text too long (max 5000 chars)")

    wav_bytes = run_piper(request.text, request.language, request.speed)
    audio_b64 = base64.b64encode(wav_bytes).decode("utf-8")

    return JSONResponse({
        "success": True,
        "audio_base64": audio_b64,
        "audio_size_bytes": len(wav_bytes),
        "format": "wav",
        "voice": VOICES[request.language]["desc"],
        "language": request.language,
        "text_length": len(request.text)
    })

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
