# Memory Lens

A phone-first memory assistant. It watches through the camera on a scalable
timer (1 second to 10 minutes), remembers where things are, and watches for
scenarios you set — then keeps only what matters.

Built with Expo (React Native, SDK 58) for iOS and Android. **Memory mode**,
**Project mode**, and **Fast Capture** are live.

## Run it on your phone

This project uses Expo SDK 58, which currently needs a **development build**
(Expo Go targets SDK 57 during the transition). Pick one:

```bash
cd /Users/prog/memory-lens
npm install          # already done if node_modules exists

# Cloud build (no local Xcode/Android Studio needed):
npx eas-cli@latest build --profile development --platform ios     # or android
npx expo start       # then open the dev build and scan the QR code

# Or build locally:
npx expo run:ios     # or: npx expo run:android
```

Checks: `npm test` (180 tests, 21 suites) · `npx tsc --noEmit` · `npx eslint .` ·
`npx expo-doctor` · `npx expo export --platform android --platform ios` ·
`node --check server/vision-server.mjs`.

## What Memory mode does today

- **Capture timer** — photo every 1s–10min (presets 1s, 5s, 15s, 30s, 1m,
  5m, 10m; code clamps to 1–600s). Default 1s per spec; raise it to save
  battery. Camera captures at the lowest available picture size + low JPEG
  quality — enough detail for AI, small on disk.
- **Camera sources** — Phone, Meta glasses, generic glasses, robot
  camera, or Simulation, switchable in the Memory tab. Meta glasses use
  the native Wearables Device Access Toolkit (`src/services/metaDAT.ts` +
  `modules/meta-dat`, development build + Meta console app ID required);
  standard generic glasses — any smart glasses or IP camera that can
  serve JPEG frames — work through a snapshot URL or a `ws://` binary
  frame stream. All sources run the identical privacy → triage → memory
  flow.
- **"Where is my…?"** — ask where your keys/wallet/etc. are; it answers from
  the last sighting ("I saw your keys on the dining table at 6:02 PM").
- **Track objects** — add anything to watch for. Frames containing a tracked
  object keep their photo.
- **Leave-without alerts** — "Don't let me leave without my keys" fires when
  an exit (front door / car door) is seen without a recent sighting.
  Alerts also arrive as local notifications (foreground or backgrounded).
- **Requirements & checklists** — "Don't let me leave before brushed teeth"
  treats vision tags as evidence for actions; named checklists (gig kit,
  groceries) check items off when seen in hand/cart and warn at exit or
  checkout when something never made it.
- **Retention controls** — review kept photos (delete per photo, memory stays
  as text), export all memories as text, wipe a day, and automatic cleanup:
  kept photos are capped (500) and pruned after 30 days, oldest first.
- **Mic only (no camera)** — voice notes (tap to record, transcribed,
  audio kept) and ambient sampling (short samples become text memories,
  audio deleted). Needs `POST /transcribe` on the backend; without it,
  voice notes save untranscribed.
- **Recaps** — End-of-day and end-of-week summaries from your text
  memories: AI-narrated via `POST /recap` with a backend, counted
  locally without one.
- **Cartoon montage** — saved event photos become a cartoon MP4
  (`POST /cartoon-montage`, server ffmpeg) with an in-app slideshow
  fallback.
- **Photo discipline** — important frames keep the photo; everything else is
  stored as a text interpretation and the photo is deleted; duplicate scenes
  are deleted outright.
- **Privacy hard-stop** — if a restroom or nudity is detected (scene tags,
  or a nudity word describing the scene), capture stops immediately and
  no photo from that frame is ever kept; the stop names its trigger. A
  private place merely *mentioned* in a caption ("toilet paper on the
  counter") never stops capture: that frame is discarded and watching
  continues.

Vision runs on a deterministic offline mock until you connect the real
backend. Try the demo first: start watching and it will find keys, suppress
a duplicate, alert on leaving without keys, then privacy-stop in a restroom
scene. Without camera permission it runs the same pipeline in simulation
(mock provider only — live vision needs real photos).

### Real vision backend

```bash
VISION_API_KEY=sk-... npm run server   # http://localhost:8787
cp .env.example .env                   # set your computer's LAN IP
npx expo start                         # restart so the URL is inlined
```

The app uploads each photo as base64 (`POST { imageBase64, mimeType }`) to
`EXPO_PUBLIC_VISION_API_URL`; `server/vision-server.mjs` sends it to any
OpenAI-compatible vision model (`VISION_MODEL`, default `gpt-4o-mini`) and
returns the `VisionResult` JSON the app expects. The model key lives only
on your computer — never in the app. Model output is parsed strictly and
fails closed (`src/services/vision/visionParse.ts`).

## What Project mode does today

Live guided-build flow (`src/app/project.tsx` +
`src/services/projectSession.ts` + `src/services/vision/projectVision.ts`):

- **Photo of the sheet → steps** — “Photograph instruction sheet” sends the
  photo to `POST /parse-instructions` and parses it into a titled plan with
  ordered steps (title, parts, instruction). Without a camera it loads a
  deterministic demo project in simulation so the flow works end to end.
- **Watch / verify** — “Watch my build” photographs the workspace every 3s
  (`POST /verify-step`) and applies the verdict through the session engine:
  `complete` marks the step done and advances (finishing the last step ends
  the session), `mistake` stays on the step with a correction detail (e.g.
  reversed wiring), and `unclear` stays and asks for a close-up. “Next step”
  / “Back” move manually through the same `applyCheck` / `previousStep`
  state machine — manual advance never bypasses session state.
- **Part-finding** — “Find a part” searches stored memories
  (`eventsSeeing` / `answerWhere`) and reports the last-seen place and
  time, or “Not seen yet”.
- **Step Q&A** — “Ask about this step” sends the question with the current
  step to `POST /ask` and shows the answer; with no backend it answers from
  the step’s own instruction text.
- **POV build recap** — record POV clips while building, then stitch
  clips + today’s photos into a sped-up timelapse MP4 (`POST /timelapse`,
  server ffmpeg) with an in-app slideshow fallback.
- **3D step preview** — each step card shows a rotatable three.js model
  built from the parsed parts list (legs, panels, screws as primitives;
  current step highlighted, future steps ghosted). Drag to rotate. Parts
  naming real dimensions ("Table top 120x60x3 cm", "Leg 70 cm", inches and
  millimeters too) render at measured size; tap any part to identify it
  (name, copy, step, state, size) in the caption below. A part may name a
  GLTF model — "Leg (model: https://…)" — rendered in place of its
  primitive, scaled to the measured size, with the primitive as fallback
  while it loads or if it fails. Layout is still a schematic staging, not
  a joined assembly.

## Layout

- `src/app/` — tabs: Memory (`index`), Project, Fast Capture, Settings
- `src/services/captureEngine.ts` — photo → privacy gate → triage → store → rules
- `src/services/privacy.ts` — restroom/nudity shutoff (runs first, absolute)
- `src/services/triage.ts` — keep / text-only / delete decisions + dedupe
- `src/services/scenarios.ts` — last-seen answers + exit/requirement/checklist alerts
- `src/services/notifications.ts` — local notifications for alerts (fail-soft)
- `src/services/retention.ts` — day wipe, export, quota/age photo selection
- `src/services/memoryStore.ts` — SQLite text memories (photo only when kept)
- `src/services/projectSession.ts` — guided-build step state machine
- `src/services/stepModel.ts` — parts list (+ dimensions / GLTF refs) → 3D scene
- `src/components/StepModelView.tsx` — rotatable, tap-to-identify 3D preview (R3F)
- `src/components/UIButton.tsx` — one button (primary/danger/secondary + spinner)
- `src/components/Section.tsx` — card section for the settings screens
- `src/components/ScreenBoundary.tsx` — per-tab error boundary
- `src/services/vision/` — provider contract, offline mock, HTTP adapter
- `src/services/vision/projectVision.ts` — sheet → steps, step verify, step Q&A
- `src/services/vision/clipVision.ts` — event-clip analysis client
- `src/services/fastCapture.ts` — frame-change trigger + event clip assembly
- `src/services/frameStream.ts` — WebSocket frame stream + ring buffer
- `src/services/metaDAT.ts` — Meta Wearables DAT surface (100% of modules)
- `src/services/eyewear.ts` — glasses profiles (Meta / generic / robot)
- `src/services/micCapture.ts` — mic-only voice notes + ambient sampling
- `src/services/recap.ts` — end-of-day/week recaps (AI + local)
- `src/services/videoJobs.ts` — cartoon montage + POV timelapse client
- `modules/meta-dat/` — native DAT module (Swift/Kotlin) + setup README
- `plugins/withMetaDat.js` — DAT app ID/token/manifest config plugin

## What Fast Capture does today

Watches a frame feed for sudden change and keeps only the seconds around
the event. Robot/glasses bridges feed frames two ways, chosen by URL
scheme: `ws://` streams live JPEG frames (one binary message per frame)
at device rate; `http://` polls snapshots (~5/s). Simulation and the
phone camera always poll.

Frames flow through a bounded ring buffer (90 frames / 4s) into the
on-device change trigger; each event keeps its pre/post window, and with
a backend configured the representative frames go to `POST /analyze-clip`
for multi-frame analysis (“what happened”), otherwise the trigger frame
is captioned alone.

Try the stream path without hardware:

```bash
npm run stream -- ./frames 10 9000   # replays JPEGs in ./frames as a stream
```

then point Fast Capture at `ws://<your-computer>:9000/frames`. A real
bridge speaks the same protocol: one complete JPEG per binary message.
(MJPEG-over-HTTP is deliberately not used: React Native's `fetch` has no
streaming response body, so an infinite multipart response never
resolves.)

## Release

Build profiles (`development`, `preview`, `production`), Meta console
activation, background-capture limits, and a device test checklist live
in [docs/release.md](/Users/prog/memory-lens/docs/release.md); store
listing copy, privacy policy, and data-safety answers are drafted in
[docs/store.md](/Users/prog/memory-lens/docs/store.md).

## Roadmap (from the full product brief)

- Everything buildable from a desk is shipped. What remains needs
  accounts or hardware: Meta console project + EAS development build
  on physical glasses/phone, live-backend testing with your
  `VISION_API_KEY`, and store submission (see Release above). Robot
  cameras beyond frame streams (WebRTC) only if latency demands it.
- Richer 3D: true joined assemblies (legs actually meeting the top)
  on top of the measured sizes, GLTF parts, and tap-to-identify shipping
  today (see “What Project mode does today” above).

## Known limits

- Mock vision by default — real object/scene AI needs the backend above
  and your own model API key (`VISION_API_KEY`).
- Meta DAT native code is written against Meta's published guides but
  has never been compiled or run (no Xcode/Android Studio, console
  project, or glasses in this environment); two image-extraction
  accessors are marked VERIFY-IN-XCODE / VERIFY-IN-ANDROID-STUDIO.
- Cartoon montage and POV timelapse need `ffmpeg` on the vision server;
  without it those buttons fall back to an in-app slideshow.
- Foreground capture only; OS background limits apply on both platforms.
- 1s capture drains battery and heats the phone; it is the spec default,
  not a recommendation for all-day wear.
- 3D previews need a development build on a physical device; iOS
  simulators have unreliable OpenGL ES support and may crash rendering 3D.
