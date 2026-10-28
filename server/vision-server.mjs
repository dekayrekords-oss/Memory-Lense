// Reference vision backend for Memory Lens.
//
//   VISION_API_KEY=sk-... npm run server
//
// POST /analyze { imageBase64, mimeType } -> VisionResult JSON
// POST /analyze-clip { frames: [{ imageBase64, mimeType, tsOffsetMs }] } -> VisionResult JSON
// POST /parse-instructions { imageBase64, mimeType } -> ProjectPlan JSON
// POST /verify-step { imageBase64, mimeType, step } -> StepCheck JSON
// POST /ask { question, step } -> { answer }
// POST /transcribe { audioBase64, mimeType } -> { text }
// POST /recap { period, events: [{ ts, caption, kind }] } -> { title, summary, highlights }
// POST /cartoon-montage { frames: [{ imageBase64 }] } -> { videoBase64 }  (needs ffmpeg)
// POST /timelapse { items: [{ kind, base64, ts }] } -> { videoBase64 }    (needs ffmpeg)
// GET  /health  -> { ok, model, keyConfigured }
//
// Talks to any OpenAI-compatible chat-completions endpoint with vision.
// Override with VISION_API_URL / VISION_MODEL. The key stays on this
// machine — never ship it inside the phone app.

import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const API_KEY = process.env.VISION_API_KEY ?? '';
const API_URL =
  process.env.VISION_API_URL ?? 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.VISION_MODEL ?? 'gpt-4o-mini';
const MAX_BODY_BYTES = 60 * 1024 * 1024;

const SYSTEM_PROMPT = `You are the eyes of a memory-assistant app. Describe one photo as JSON only — no prose, no markdown fences.

Schema:
{
  "caption": "short human-readable description",
  "objects": [{ "name": "keys", "place": "dining table or null", "confidence": 0.0-1.0 }],
  "tags": ["indoor", "kitchen"],
  "importance": 0.0-1.0
}

Rules:
- "objects": everyday items a person might look for later (keys, wallet, phone, glasses, tools, instruments). "place" is where the object rests, or null.
- "tags": scene labels. You MUST include "restroom" or "bathroom" for restrooms, "nudity" if a person is nude or intimate body parts are visible, "exit" plus "front-door" or "car-door" when someone is leaving a building or opening a car door.
- "importance": how worth remembering this moment is (unusual, emotional, or task-relevant = high; blank walls and repeats = low).`;

const PARSE_INSTRUCTIONS_PROMPT = `You parse a photographed instruction sheet into LEGO/IKEA-style steps. Reply with JSON only — no prose, no markdown fences.

Schema:
{
  "title": "what is being built or fixed",
  "steps": [
    { "title": "short step title", "parts": ["part or tool needed"], "instruction": "one clear action to do in this step" }
  ]
}

Rules:
- Keep the steps in the order shown on the sheet. One step per numbered or pictured stage.
- "parts": the parts, pieces, or tools that step needs; empty list when none are named.
- "instruction": a single plain-language action the user can follow, in the order it should be done.
- If a step is unreadable, still include it with your best reading of its title and an empty instruction — never invent parts or actions that are not on the sheet.`;

const VERIFY_STEP_PROMPT = `You check one photographed build/repair step against its instruction. Reply with JSON only — no prose, no markdown fences.

Schema:
{
  "verdict": "complete" | "mistake" | "unclear",
  "detail": "what you see, in plain language",
  "confidence": 0.0-1.0
}

Rules:
- "complete" only when the photo clearly shows the step done as instructed.
- "mistake" only for a visible concrete error — name it in "detail" (e.g. reversed wiring, wrong part, screw in the wrong hole). Never report a mistake you cannot point to in the photo.
- "unclear" when the relevant area is not visible/occluded — never guess. Use "unclear" whenever the part the step is about cannot be seen clearly enough to judge.
- "confidence": how sure you are of the verdict (occluded or blurry photo = low).`;

const ANALYZE_CLIP_PROMPT = `You watch a burst of frames from a fast event camera and describe what happened. Reply with JSON only — no prose, no markdown fences.

Schema:
{
  "caption": "short human-readable description of the event",
  "objects": [{ "name": "glass", "place": "floor or null", "confidence": 0.0-1.0 }],
  "tags": ["indoor", "kitchen"],
  "importance": 0.0-1.0
}

Rules:
- The frames are in time order with millisecond offsets. "caption" must describe the change or motion across frames (what moved, fell, entered, or broke), not just one still.
- "objects": the items involved in the event, with where each ended up in "place" (or null). Everyday items a person might look for later.
- "tags": scene labels, using the same vocabulary as single photos ("exit", "front-door", "car-door", "restroom", "nudity" when they apply).
- "importance": how worth remembering this event is (unexpected motion or damage = high; passing shadows and camera wobble = low).`;

const ASK_PROMPT = `You answer a short question about one step of a build/repair project. Reply with JSON only — no prose, no markdown fences.

Schema:
{
  "answer": "short plain-language answer"
}

Rules:
- Answer only about the step given below, in plain language a beginner can follow.
- Keep it short: one to three sentences. No lists, no jargon without a plain explanation.
- If the step does not contain the answer, say so plainly instead of inventing one.`;

// Mirrors src/services/vision/visionParse.ts — keep the two in sync.
function clamp01(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normalize(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in model output');
    value = JSON.parse(raw.slice(start, end + 1));
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('model output is not a JSON object');
  }
  const objects = (Array.isArray(value.objects) ? value.objects : [])
    .filter((o) => o && typeof o === 'object' && typeof o.name === 'string' && o.name.trim())
    .map((o) => ({
      name: o.name.trim(),
      place: typeof o.place === 'string' && o.place.trim() ? o.place.trim() : null,
      confidence: clamp01(o.confidence),
    }));
  return {
    caption: typeof value.caption === 'string' ? value.caption.trim() : '',
    objects,
    tags: (Array.isArray(value.tags) ? value.tags : [])
      .filter((t) => typeof t === 'string')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    importance: clamp01(value.importance),
  };
}

// Mirrors the ProjectPlan shape in src/services/types.ts — keep in sync.
function normalizeProjectPlan(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in model output');
    value = JSON.parse(raw.slice(start, end + 1));
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('model output is not a JSON object');
  }
  const steps = (Array.isArray(value.steps) ? value.steps : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      title: typeof s.title === 'string' ? s.title.trim() : '',
      parts: (Array.isArray(s.parts) ? s.parts : [])
        .filter((p) => typeof p === 'string')
        .map((p) => p.trim())
        .filter(Boolean),
      instruction: typeof s.instruction === 'string' ? s.instruction.trim() : '',
    }))
    .filter((s) => s.title || s.instruction);
  return {
    title: typeof value.title === 'string' ? value.title.trim() : '',
    steps,
  };
}

const VERDICTS = ['complete', 'mistake', 'unclear'];

// Mirrors the StepCheck shape in src/services/types.ts — keep in sync.
// An unrecognized verdict becomes "unclear": never guess complete/mistake.
function normalizeStepCheck(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in model output');
    value = JSON.parse(raw.slice(start, end + 1));
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('model output is not a JSON object');
  }
  return {
    verdict: VERDICTS.includes(value.verdict) ? value.verdict : 'unclear',
    detail: typeof value.detail === 'string' ? value.detail.trim() : '',
    confidence: clamp01(value.confidence),
  };
}

const RECAP_PROMPT = `You write a short end-of-period recap from a person's text memories. Reply with JSON only — no prose, no markdown fences.

Schema:
{
  "title": "short recap title",
  "summary": "2-3 sentence narrative of the period",
  "highlights": ["one memorable moment per entry, up to 5"]
}

Rules:
- Use only the memories given, in time order. Never invent events, objects, or places that are not in the memories.
- "highlights": pick the most memorable or useful moments (found objects, completed work, unusual events) verbatim-ish from the memories; at most 5.
- Warm, plain language a beginner can follow. No lists inside "summary".`;

// Mirrors src/services/recap.ts parseRecap — keep the two in sync.
function normalizeRecap(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in model output');
    value = JSON.parse(raw.slice(start, end + 1));
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('model output is not a JSON object');
  }
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  if (!title || !summary) throw new Error('recap needs a title and summary');
  const highlights = (Array.isArray(value.highlights) ? value.highlights : [])
    .filter((h) => typeof h === 'string')
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 8);
  return { title, summary, highlights };
}

function normalizeAnswer(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in model output');
    value = JSON.parse(raw.slice(start, end + 1));
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('model output is not a JSON object');
  }
  return {
    answer: typeof value.answer === 'string' ? value.answer.trim() : '',
  };
}

function imagePart(imageBase64, mimeType) {
  return {
    type: 'image_url',
    image_url: { url: `data:${mimeType};base64,${imageBase64}` },
  };
}

async function callModel(systemPrompt, userContent) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`vision model failed: ${response.status}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('empty model response');
  return content;
}

async function analyzeWithModel(imageBase64, mimeType) {
  const content = await callModel(SYSTEM_PROMPT, [
    { type: 'text', text: 'Describe this photo as JSON.' },
    imagePart(imageBase64, mimeType),
  ]);
  return normalize(content);
}

async function parseInstructionsWithModel(imageBase64, mimeType) {
  const content = await callModel(PARSE_INSTRUCTIONS_PROMPT, [
    { type: 'text', text: 'Parse this instruction sheet into steps as JSON.' },
    imagePart(imageBase64, mimeType),
  ]);
  return normalizeProjectPlan(content);
}

function formatStep(step) {
  const parts = step.parts.length ? step.parts.join(', ') : 'none listed';
  return `Step: ${step.title}\nParts: ${parts}\nInstruction: ${step.instruction}`;
}

async function verifyStepWithModel(imageBase64, mimeType, step) {
  const content = await callModel(VERIFY_STEP_PROMPT, [
    {
      type: 'text',
      text: `Check the photo against this step and reply as JSON.\n${formatStep(step)}`,
    },
    imagePart(imageBase64, mimeType),
  ]);
  return normalizeStepCheck(content);
}

async function analyzeClipWithModel(frames) {
  const userContent = [
    {
      type: 'text',
      text: `Describe what happened across these ${frames.length} frames in time order.`,
    },
  ];
  frames.forEach((frame, i) => {
    userContent.push({
      type: 'text',
      text: `Frame ${i + 1} (+${frame.tsOffsetMs}ms):`,
    });
    userContent.push(imagePart(frame.imageBase64, frame.mimeType));
  });
  const content = await callModel(ANALYZE_CLIP_PROMPT, userContent);
  return normalize(content);
}

async function recapWithModel(events, period) {
  const lines = events.map((e) => {
    const when = new Date(e.ts).toLocaleString();
    return `- [${when}] (${e.kind}) ${e.caption}`;
  });
  const content = await callModel(RECAP_PROMPT, [
    {
      type: 'text',
      text: `Write the end-of-${period} recap from these memories:\n${lines.join('\n')}`,
    },
  ]);
  return normalizeRecap(content);
}

const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? 'whisper-1';

async function transcribeWithModel(audioBase64, mimeType) {
  const base = API_URL.replace(/\/chat\/completions\/?$/, '');
  const form = new FormData();
  const bytes = Buffer.from(audioBase64, 'base64');
  form.append('file', new Blob([bytes], { type: mimeType }), 'audio.m4a');
  form.append('model', TRANSCRIBE_MODEL);
  const response = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`transcription model failed: ${response.status}`);
  }
  const data = await response.json();
  if (typeof data?.text !== 'string') throw new Error('empty transcription');
  return { text: data.text.trim() };
}

// --- Video jobs (ffmpeg) -------------------------------------------------
// Probed once at startup; endpoints answer 503 when ffmpeg is missing so
// the app can fall back to an in-app slideshow instead of failing mute.

const FFMPEG_OK = (() => {
  try {
    return spawnSync('ffmpeg', ['-hide_banner', '-version']).status === 0;
  } catch {
    return false;
  }
})();

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-300)}`));
    });
  });
}

const VIDEO_FILTER =
  'scale=720:1280:force_original_aspect_ratio=decrease,' +
  'pad=720:1280:(ow-iw)/2:(oh-ih)/2,format=yuv420p';
const CARTOON_FILTER =
  'scale=720:1280:force_original_aspect_ratio=decrease,' +
  'pad=720:1280:(ow-iw)/2:(oh-ih)/2,smartblur=lr=1.2:ls=0.7,' +
  "geq=r='trunc(r(X\\,Y)/42)*42':g='trunc(g(X\\,Y)/42)*42':b='trunc(b(X\\,Y)/42)*42'," +
  'eq=saturation=1.5:contrast=1.05,format=yuv420p';

async function segmentFromImage(dir, index, imageBase64, seconds, cartoon) {
  const input = join(dir, `in-${index}.jpg`);
  const output = join(dir, `seg-${index}.mp4`);
  await writeFile(input, Buffer.from(imageBase64, 'base64'));
  await runFfmpeg([
    '-y', '-loop', '1', '-i', input,
    '-t', String(seconds),
    '-vf', cartoon ? CARTOON_FILTER : VIDEO_FILTER,
    '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
  ]);
  return output;
}

async function segmentFromVideo(dir, index, videoBase64, speedup) {
  const input = join(dir, `in-${index}.mp4`);
  const output = join(dir, `seg-${index}.mp4`);
  await writeFile(input, Buffer.from(videoBase64, 'base64'));
  await runFfmpeg([
    '-y', '-i', input,
    '-vf', `setpts=PTS/${speedup},${VIDEO_FILTER}`,
    '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', output,
  ]);
  return output;
}

async function concatSegments(dir, segments) {
  const listPath = join(dir, 'list.txt');
  await writeFile(
    listPath,
    segments.map((s) => `file '${s}'`).join('\n'),
  );
  const output = join(dir, 'out.mp4');
  await runFfmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c', 'copy', output,
  ]);
  return readFile(output);
}

const MAX_FRAMES = 24;
const MAX_ITEMS = 40;

function readImageList(body) {
  const frames = body?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  if (frames.length > MAX_FRAMES) return null;
  const out = [];
  for (const f of frames) {
    if (typeof f?.imageBase64 !== 'string' || !f.imageBase64) return null;
    out.push(f.imageBase64);
  }
  return out;
}

function readTimelapseItems(body) {
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  if (items.length > MAX_ITEMS) return null;
  const out = [];
  for (const item of items) {
    if (
      (item?.kind !== 'image' && item?.kind !== 'video') ||
      typeof item?.base64 !== 'string' ||
      !item.base64
    ) {
      return null;
    }
    const ts = Number(item.ts);
    out.push({
      kind: item.kind,
      base64: item.base64,
      ts: Number.isFinite(ts) ? ts : 0,
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

async function cartoonMontage(frames) {
  const dir = await mkdtemp(join(tmpdir(), 'ml-montage-'));
  try {
    const segments = [];
    for (let i = 0; i < frames.length; i += 1) {
      segments.push(await segmentFromImage(dir, i, frames[i], 1.6, true));
    }
    const video = await concatSegments(dir, segments);
    return { videoBase64: video.toString('base64'), mimeType: 'video/mp4' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function timelapse(items) {
  const dir = await mkdtemp(join(tmpdir(), 'ml-timelapse-'));
  try {
    const segments = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      segments.push(
        item.kind === 'image'
          ? await segmentFromImage(dir, i, item.base64, 0.12, false)
          : await segmentFromVideo(dir, i, item.base64, 6),
      );
    }
    const video = await concatSegments(dir, segments);
    return { videoBase64: video.toString('base64'), mimeType: 'video/mp4' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function askWithModel(question, step) {
  const content = await callModel(ASK_PROMPT, [
    {
      type: 'text',
      text: `${formatStep(step)}\n\nQuestion: ${question}`,
    },
  ]);
  const { answer } = normalizeAnswer(content);
  if (!answer) throw new Error('empty model response');
  return { answer };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readStep(body) {
  const step = body?.step;
  if (typeof step !== 'object' || step === null || Array.isArray(step)) return null;
  const normalized = {
    title: typeof step.title === 'string' ? step.title.trim() : '',
    parts: (Array.isArray(step.parts) ? step.parts : [])
      .filter((p) => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean),
    instruction: typeof step.instruction === 'string' ? step.instruction.trim() : '',
  };
  if (!normalized.title && !normalized.instruction) return null;
  return normalized;
}

function readImage(body) {
  if (typeof body?.imageBase64 !== 'string' || !body.imageBase64) return null;
  return {
    imageBase64: body.imageBase64,
    mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg',
  };
}

const MAX_CLIP_FRAMES = 6;

function readClipFrames(body) {
  const frames = body?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  if (frames.length > MAX_CLIP_FRAMES) return null;
  const normalized = [];
  for (const frame of frames) {
    if (
      typeof frame !== 'object' ||
      frame === null ||
      typeof frame.imageBase64 !== 'string' ||
      !frame.imageBase64
    ) {
      return null;
    }
    const tsOffsetMs = Number(frame.tsOffsetMs);
    normalized.push({
      imageBase64: frame.imageBase64,
      mimeType: typeof frame.mimeType === 'string' ? frame.mimeType : 'image/jpeg',
      tsOffsetMs: Number.isFinite(tsOffsetMs) && tsOffsetMs >= 0 ? Math.round(tsOffsetMs) : 0,
    });
  }
  return normalized;
}

const POST_ROUTES = [
  '/analyze',
  '/analyze-clip',
  '/parse-instructions',
  '/verify-step',
  '/ask',
  '/transcribe',
  '/recap',
  '/cartoon-montage',
  '/timelapse',
];

// Local ffmpeg work — no model key needed.
const KEYLESS_ROUTES = new Set(['/cartoon-montage', '/timelapse']);

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, model: MODEL, keyConfigured: Boolean(API_KEY) });
    return;
  }
  if (req.method !== 'POST' || !POST_ROUTES.includes(req.url)) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  if (!API_KEY && !KEYLESS_ROUTES.has(req.url)) {
    sendJson(res, 503, {
      error: 'VISION_API_KEY is not set. Run: VISION_API_KEY=sk-... npm run server',
    });
    return;
  }
  if (KEYLESS_ROUTES.has(req.url) && !FFMPEG_OK) {
    sendJson(res, 503, {
      error: 'ffmpeg is not available on this server. Install ffmpeg, or use the in-app slideshow.',
    });
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) req.destroy(new Error('body too large'));
    else chunks.push(chunk);
  });
  req.on('end', async () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/cartoon-montage') {
        const frames = readImageList(body);
        if (!frames) {
          sendJson(res, 400, {
            error: `frames (array of 1-${MAX_FRAMES} { imageBase64 }) is required`,
          });
          return;
        }
        sendJson(res, 200, await cartoonMontage(frames));
        return;
      }
      if (req.url === '/timelapse') {
        const items = readTimelapseItems(body);
        if (!items) {
          sendJson(res, 400, {
            error: `items (array of 1-${MAX_ITEMS} { kind, base64, ts }) is required`,
          });
          return;
        }
        sendJson(res, 200, await timelapse(items));
        return;
      }
      if (req.url === '/transcribe') {
        if (typeof body.audioBase64 !== 'string' || !body.audioBase64) {
          sendJson(res, 400, { error: 'audioBase64 (string) is required' });
          return;
        }
        const mimeType =
          typeof body.mimeType === 'string' ? body.mimeType : 'audio/m4a';
        sendJson(res, 200, await transcribeWithModel(body.audioBase64, mimeType));
        return;
      }
      if (req.url === '/recap') {
        const period = body.period === 'week' ? 'week' : 'day';
        const events = (Array.isArray(body.events) ? body.events : [])
          .filter(
            (e) =>
              e &&
              typeof e === 'object' &&
              typeof e.caption === 'string' &&
              Number.isFinite(Number(e.ts)),
          )
          .slice(-200)
          .map((e) => ({
            ts: Number(e.ts),
            caption: e.caption,
            kind: typeof e.kind === 'string' ? e.kind : 'scene',
          }));
        sendJson(res, 200, await recapWithModel(events, period));
        return;
      }
      if (req.url === '/ask') {
        if (typeof body.question !== 'string' || !body.question.trim()) {
          sendJson(res, 400, { error: 'question (string) is required' });
          return;
        }
        const step = readStep(body);
        if (!step) {
          sendJson(res, 400, {
            error: 'step (object with title or instruction) is required',
          });
          return;
        }
        sendJson(res, 200, await askWithModel(body.question.trim(), step));
        return;
      }
      if (req.url === '/analyze-clip') {
        const frames = readClipFrames(body);
        if (!frames) {
          sendJson(res, 400, {
            error: `frames (array of 1-${MAX_CLIP_FRAMES} { imageBase64 }) is required`,
          });
          return;
        }
        sendJson(res, 200, await analyzeClipWithModel(frames));
        return;
      }
      const image = readImage(body);
      if (!image) {
        sendJson(res, 400, { error: 'imageBase64 (string) is required' });
        return;
      }
      if (req.url === '/analyze') {
        sendJson(res, 200, await analyzeWithModel(image.imageBase64, image.mimeType));
        return;
      }
      if (req.url === '/parse-instructions') {
        sendJson(
          res,
          200,
          await parseInstructionsWithModel(image.imageBase64, image.mimeType),
        );
        return;
      }
      // req.url === '/verify-step'
      const step = readStep(body);
      if (!step) {
        sendJson(res, 400, {
          error: 'step (object with title or instruction) is required',
        });
        return;
      }
      sendJson(
        res,
        200,
        await verifyStepWithModel(image.imageBase64, image.mimeType, step),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('vision model failed') ? 502 : 400;
      sendJson(res, status, { error: message });
    }
  });
  req.on('error', () => sendJson(res, 400, { error: 'could not read body' }));
});

server.listen(PORT, () => {
  console.log(
    `Memory Lens vision server on http://localhost:${PORT} (model: ${MODEL}, key: ${API_KEY ? 'set' : 'MISSING'})`,
  );
});
