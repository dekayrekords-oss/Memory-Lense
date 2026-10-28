// Reference frame-stream server for Fast Capture testing.
//
//   node server/frame-stream.mjs ./frames [fps] [port]
//
// Replays the JPEGs in a folder as a live stream: one binary WebSocket
// message per frame, looping forever. Point the Fast Capture screen at
// ws://<your-computer>:9000/frames to exercise the streaming pipeline
// with real sockets. A real glasses/robot bridge speaks the same
// protocol: each binary message is one complete JPEG frame.
//
// Dev-only tooling (the `ws` package is a devDependency) — nothing in
// src/ imports this, so it never ships in the app bundle.

import { readdirSync, readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';

const dir = process.argv[2] ?? './frames';
const fps = Math.min(30, Math.max(1, Number(process.argv[3] ?? 10)));
const port = Number(process.argv[4] ?? 9000);

let files;
try {
  files = readdirSync(dir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort()
    .map((f) => `${dir}/${f}`);
} catch {
  console.error(`Cannot read frames directory: ${dir}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`No JPEGs in ${dir} — drop some frames in and retry.`);
  process.exit(1);
}
const frames = files.map((f) => readFileSync(f));
console.log(
  `Streaming ${frames.length} frames from ${dir} at ${fps} fps on ws://localhost:${port}/frames`,
);

const wss = new WebSocketServer({ port, path: '/frames' });
wss.on('connection', (ws) => {
  console.log('client connected');
  let i = 0;
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(frames[i % frames.length]);
    i += 1;
  }, 1000 / fps);
  ws.on('close', () => {
    clearInterval(timer);
    console.log('client disconnected');
  });
  ws.on('error', () => clearInterval(timer));
});
