import os
import tempfile
from fastapi import FastAPI, HTTPException
from pydub import AudioSegment
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Piper TTS Service")

# Allow n8n calls from anywhere
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PIPER_BINARY = "./piper/piper"
MODELS_DIR = os.getenv("MODELS_DIR", "./models")
CHUNK_SIZE = 2000  # max characters per Piper call

def split_text(text: str, max_len=CHUNK_SIZE):
    """Split text into safe chunks for TTS"""
    return [text[i:i+max_len] for i in range(0, len(text), max_len)]

@app.post("/speak")
async def speak(payload: dict):
    text = payload.get("text")
    voice = payload.get("voice")
    if not text or not voice:
        raise HTTPException(status_code=400, detail="Missing 'text' or 'voice'")

    model_path = os.path.join(MODELS_DIR, voice + ".onnx")
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail=f"Voice model {voice} not found")

    audio_chunks = []

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, chunk in enumerate(split_text(text)):
            chunk_file = os.path.join(tmpdir, f"chunk_{idx}.wav")
            cmd = f'{PIPER_BINARY} --model "{model_path}" --text "{chunk}" --output "{chunk_file}"'
            ret = os.system(cmd)
            if ret != 0:
                raise HTTPException(status_code=500, detail="Piper TTS failed")
            audio_chunks.append(AudioSegment.from_wav(chunk_file))

        # Combine all chunks
        final_audio = sum(audio_chunks)
        output_file = os.path.join(tmpdir, "final.wav")
        final_audio.export(output_file, format="wav")

        # Return audio bytes
        return {
            "audio_filename": "tts.wav",
            "audio_bytes": open(output_file, "rb").read()
        }
