// ─────────────────────────────────────────────────────
// TTS API Server
// Endpoints:
//   GET  /health           → health check
//   POST /tts              → generate audio
//   POST /tts/arabic       → Arabic only shortcut
//   POST /tts/english      → English only shortcut
//   POST /tts/both         → Arabic + English merged
// ─────────────────────────────────────────────────────

const http = require('http');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT || 3000;
const AR_MODEL = process.env.AR_MODEL || '/usr/local/share/piper-voices/ar_JO-kareem-medium.onnx';
const EN_MODEL = process.env.EN_MODEL || '/usr/local/share/piper-voices/en_GB-vctk-medium.onnx';
const API_KEY  = process.env.API_KEY || null; // optional auth

// ── helpers ──────────────────────────────────────────

function tmpFile(ext) {
  return path.join(os.tmpdir(), `tts_${crypto.randomBytes(6).toString('hex')}.${ext}`);
}

function runPiper(text, model, outWav) {
  return new Promise((resolve, reject) => {
    const proc = require('child_process').spawn(
      '/usr/local/bin/piper',
      ['--model', model, '--output_file', outWav],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outWav) && fs.statSync(outWav).size > 0) {
        resolve();
      } else {
        reject(new Error(`Piper exited ${code} for model ${model}`));
      }
    });
    proc.on('error', reject);
  });
}

function wavToMp3(wavFile, mp3File) {
  return new Promise((resolve, reject) => {
    execFile('/usr/local/bin/ffmpeg', [
      '-y', '-i', wavFile,
      '-codec:a', 'libmp3lame', '-qscale:a', '2',
      mp3File
    ], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function mergeAudios(file1, file2, outFile) {
  return new Promise((resolve, reject) => {
    execFile('/usr/local/bin/ffmpeg', [
      '-y',
      '-i', file1,
      '-i', file2,
      '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]',
      '-map', '[a]',
      outFile
    ], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendError(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

function checkAuth(req, res) {
  if (!API_KEY) return true;
  const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (key === API_KEY) return true;
  sendError(res, 401, 'Invalid API key');
  return false;
}

// ── main handler ─────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method.toUpperCase();

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health check
  if (url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      voices: {
        arabic: fs.existsSync(AR_MODEL),
        english: fs.existsSync(EN_MODEL)
      },
      endpoints: [
        'POST /tts        — body: { text, lang, format }',
        'POST /tts/arabic — body: { text, format }',
        'POST /tts/english — body: { text, format }',
        'POST /tts/both   — body: { arabic, english, format }'
      ]
    }));
    return;
  }

  if (method !== 'POST') {
    sendError(res, 405, 'Method not allowed'); return;
  }

  if (!checkAuth(req, res)) return;

  const body = await readBody(req);

  // ── POST /tts ──────────────────────────────────────
  // body: { text: "...", lang: "ar"|"en", format: "mp3"|"wav" }
  if (url === '/tts') {
    const text   = body.text || '';
    const lang   = body.lang || 'ar';
    const format = body.format || 'mp3';

    if (!text) { sendError(res, 400, 'text is required'); return; }

    const model = lang === 'en' ? EN_MODEL : AR_MODEL;
    const wav   = tmpFile('wav');
    const out   = format === 'wav' ? wav : tmpFile('mp3');

    try {
      await runPiper(text, model, wav);
      if (format === 'mp3') await wavToMp3(wav, out);

      const audio = fs.readFileSync(out);
      res.writeHead(200, {
        'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        'Content-Length': audio.length,
        'X-Lang': lang,
        'X-Format': format
      });
      res.end(audio);
    } catch (err) {
      console.error('/tts error:', err.message);
      sendError(res, 500, err.message);
    } finally {
      cleanup(wav, format === 'mp3' ? out : null);
    }
    return;
  }

  // ── POST /tts/arabic ──────────────────────────────
  if (url === '/tts/arabic') {
    const text   = body.text || '';
    const format = body.format || 'mp3';

    if (!text) { sendError(res, 400, 'text is required'); return; }

    const wav = tmpFile('wav');
    const out = format === 'wav' ? wav : tmpFile('mp3');

    try {
      await runPiper(text, AR_MODEL, wav);
      if (format === 'mp3') await wavToMp3(wav, out);

      const audio = fs.readFileSync(out);
      res.writeHead(200, {
        'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        'Content-Length': audio.length
      });
      res.end(audio);
    } catch (err) {
      console.error('/tts/arabic error:', err.message);
      sendError(res, 500, err.message);
    } finally {
      cleanup(wav, format === 'mp3' ? out : null);
    }
    return;
  }

  // ── POST /tts/english ─────────────────────────────
  if (url === '/tts/english') {
    const text   = body.text || '';
    const format = body.format || 'mp3';

    if (!text) { sendError(res, 400, 'text is required'); return; }

    const wav = tmpFile('wav');
    const out = format === 'wav' ? wav : tmpFile('mp3');

    try {
      await runPiper(text, EN_MODEL, wav);
      if (format === 'mp3') await wavToMp3(wav, out);

      const audio = fs.readFileSync(out);
      res.writeHead(200, {
        'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        'Content-Length': audio.length
      });
      res.end(audio);
    } catch (err) {
      console.error('/tts/english error:', err.message);
      sendError(res, 500, err.message);
    } finally {
      cleanup(wav, format === 'mp3' ? out : null);
    }
    return;
  }

  // ── POST /tts/both ────────────────────────────────
  // body: { arabic: "...", english: "...", format: "mp3" }
  // Returns merged audio: Arabic first, then English
  if (url === '/tts/both') {
    const arText = body.arabic  || body.ar || '';
    const enText = body.english || body.en || '';
    const format = body.format || 'mp3';

    if (!arText && !enText) {
      sendError(res, 400, 'arabic and/or english text required'); return;
    }

    const arWav  = tmpFile('wav');
    const enWav  = tmpFile('wav');
    const arMp3  = tmpFile('mp3');
    const enMp3  = tmpFile('mp3');
    const merged = tmpFile('mp3');

    try {
      // Generate both in parallel
      const tasks = [];
      if (arText) tasks.push(runPiper(arText, AR_MODEL, arWav).then(() => wavToMp3(arWav, arMp3)));
      if (enText) tasks.push(runPiper(enText, EN_MODEL, enWav).then(() => wavToMp3(enWav, enMp3)));
      await Promise.all(tasks);

      let finalFile;
      if (arText && enText) {
        await mergeAudios(arMp3, enMp3, merged);
        finalFile = merged;
      } else if (arText) {
        finalFile = arMp3;
      } else {
        finalFile = enMp3;
      }

      const audio = fs.readFileSync(finalFile);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audio.length,
        'X-Has-Arabic': arText ? 'true' : 'false',
        'X-Has-English': enText ? 'true' : 'false'
      });
      res.end(audio);
    } catch (err) {
      console.error('/tts/both error:', err.message);
      sendError(res, 500, err.message);
    } finally {
      cleanup(arWav, enWav, arMp3, enMp3, merged);
    }
    return;
  }

  sendError(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TTS API running on port ${PORT}`);
  console.log(`Arabic model: ${AR_MODEL} — exists: ${fs.existsSync(AR_MODEL)}`);
  console.log(`English model: ${EN_MODEL} — exists: ${fs.existsSync(EN_MODEL)}`);
});
