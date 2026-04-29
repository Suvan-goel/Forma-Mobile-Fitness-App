#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const START_MARKER = '=== LANDMARK_RECORDING_START ===';
const END_MARKER = '=== LANDMARK_RECORDING_END ===';

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function stripMetroPrefix(line) {
  let cleaned = stripAnsi(line).replace(/\r$/, '');
  cleaned = cleaned.replace(/^\s*›\s*/, '');
  cleaned = cleaned.replace(/^\s*(?:LOG|INFO|WARN|ERROR)\s+/, '');
  cleaned = cleaned.replace(/^\s*(?:iOS|Android|Web)\s+(?:Bundled|LOG|INFO|WARN|ERROR)\s+/, '');
  cleaned = cleaned.replace(/^\s*›\s*/, '');
  cleaned = cleaned.replace(/^\s*(?:LOG|INFO|WARN|ERROR)\s+/, '');
  return cleaned;
}

function sanitizeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function filenameForRecording(recording) {
  const exercise = sanitizeFilename(String(recording.exerciseName || 'Unknown').replace(/\s+/g, '_'));
  const recordedAt = recording.metadata?.recordedAt
    ? sanitizeFilename(String(recording.metadata.recordedAt).replace(/[:.]/g, '-'))
    : new Date().toISOString().replace(/[:.]/g, '-');
  return `recording_${exercise}_${recordedAt}.json`;
}

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

let capturing = false;
let captureChunks = [];
let pending = '';

function saveCapturedRecording() {
  const raw = captureChunks.join('');
  captureChunks = [];

  try {
    const recording = JSON.parse(raw);
    if (!recording || typeof recording.exerciseName !== 'string' || !Array.isArray(recording.frames)) {
      throw new Error('Captured JSON is not a landmark recording');
    }

    const filename = filenameForRecording(recording);
    const dest = path.join(RECORDINGS_DIR, filename);
    fs.writeFileSync(dest, `${JSON.stringify(recording)}\n`);
    console.log(`[recording-capture] Saved ${recording.frames.length} frames: ${dest}`);
  } catch (error) {
    const fallback = path.join(RECORDINGS_DIR, `recording_capture_failed_${Date.now()}.txt`);
    fs.writeFileSync(fallback, raw);
    console.warn(`[recording-capture] Failed to parse recording JSON: ${error.message}`);
    console.warn(`[recording-capture] Raw capture written to ${fallback}`);
  }
}

function processLine(line) {
  const cleaned = stripMetroPrefix(line);

  if (cleaned.includes(START_MARKER)) {
    capturing = true;
    captureChunks = [];
    console.log('[recording-capture] Landmark recording capture started.');
    return;
  }

  if (cleaned.includes(END_MARKER)) {
    if (capturing) {
      console.log('[recording-capture] Landmark recording capture ended.');
      saveCapturedRecording();
    } else {
      console.warn('[recording-capture] Saw END marker without START marker.');
    }
    capturing = false;
    return;
  }

  if (capturing) {
    captureChunks.push(cleaned.trim());
  }
}

function processOutput(chunk) {
  pending += chunk.toString('utf8');
  const lines = pending.split(/\n/);
  pending = lines.pop() || '';
  for (const line of lines) processLine(line);
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available Metro port found from ${startPort} to ${startPort + 19}`);
}

async function main() {
  const passthroughArgs = process.argv.slice(2);
  const hasExplicitPort = passthroughArgs.some(arg => arg === '--port' || arg.startsWith('--port=') || arg === '-p');
  const expoArgs = ['expo', 'start', '--dev-client', '--tunnel', ...passthroughArgs];

  if (!hasExplicitPort) {
    // Avoid Expo's interactive "Use port 8082 instead?" prompt when another
    // Metro server is already on 8081. The wrapper runs Expo with piped output
    // so it must always pass an explicit port.
    const preferredPort = Number(process.env.EXPO_RECORDING_CAPTURE_PORT || 8082);
    const port = await findAvailablePort(preferredPort);
    if (port !== preferredPort) {
      console.log(`[recording-capture] Port ${preferredPort} is busy; using ${port}.`);
    }
    expoArgs.push('--port', String(port));
  }

  console.log(`[recording-capture] Running: npx ${expoArgs.join(' ')}`);
  console.log(`[recording-capture] Watching Metro logs for landmark recordings.`);
  console.log(`[recording-capture] Writing JSON files to ${RECORDINGS_DIR}`);

  const child = spawn('npx', expoArgs, {
    cwd: path.join(__dirname, '..'),
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  });

  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    processOutput(chunk);
  });

  child.stderr.on('data', chunk => {
    process.stderr.write(chunk);
    processOutput(chunk);
  });

  child.on('exit', (code, signal) => {
    if (pending) processLine(pending);
    if (capturing && captureChunks.length > 0) {
      console.warn('[recording-capture] Expo exited while a recording capture was open.');
      saveCapturedRecording();
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch(error => {
  console.error(`[recording-capture] ${error.message}`);
  process.exit(1);
});
