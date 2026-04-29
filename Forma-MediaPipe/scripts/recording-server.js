#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.LANDMARK_RECORDING_PORT || 8765);
const RECORDINGS_DIR = path.join(__dirname, 'recordings');

function sanitizeFilename(value) {
  const basename = path.basename(value || '');
  const safe = basename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.endsWith('.json') ? safe : `${safe || `recording_${Date.now()}`}.json`;
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Recording-Filename',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    jsonResponse(res, 204, {});
    return;
  }

  if (req.method !== 'POST' || req.url !== '/recording') {
    jsonResponse(res, 404, { error: 'POST /recording expected' });
    return;
  }

  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const recording = JSON.parse(body);
      if (!recording || typeof recording.exerciseName !== 'string' || !Array.isArray(recording.frames)) {
        jsonResponse(res, 400, { error: 'Invalid landmark recording JSON' });
        return;
      }

      const requestedName = req.headers['x-recording-filename'];
      const filename = sanitizeFilename(Array.isArray(requestedName) ? requestedName[0] : requestedName);
      const dest = path.join(RECORDINGS_DIR, filename);
      fs.writeFileSync(dest, `${JSON.stringify(recording)}\n`);

      console.log(`[recording-server] Saved ${recording.frames.length} frames: ${dest}`);
      jsonResponse(res, 200, { ok: true, path: dest });
    } catch (error) {
      jsonResponse(res, 400, { error: error.message });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[recording-server] Listening on http://0.0.0.0:${PORT}/recording`);
  console.log(`[recording-server] Writing JSON files to ${RECORDINGS_DIR}`);
});
