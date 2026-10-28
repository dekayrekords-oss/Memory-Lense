# Store submission package — Memory Lens

Copy is drafted below; values in [brackets] are yours to confirm.
Final numbers (IDs, URLs) live in `eas.json` and `app.json`.

## Listing

- **Name:** Memory Lens
- **Subtitle (iOS):** Remembers where things are
- **Short description (Android):** A wearable memory that watches for
  what matters and tells you where it went.
- **Full description (draft):**

  Memory Lens is a second memory for real life. Point it at your day
  and it quietly remembers where your keys, phone, and tools ended up —
  then answers "Where are my keys?" in plain words. Tell it "don't let
  me leave without my wallet" and it warns you at the door. It checks
  off gig kits and grocery lists as items land in your bag or cart.

  Building something? Photograph the instruction sheet and Memory Lens
  walks you through it step by step — showing a 3D preview, checking
  each step with its camera, and even finding parts you lost mid-build.

  Everything is private by design: photos are turned into short text
  memories on your phone, unimportant and private frames are deleted
  immediately, and nothing is uploaded unless you run your own vision
  backend. Works with your phone camera, Meta glasses, any smart
  glasses or robot camera that can serve frames, or your microphone
  alone.

- **Keywords (iOS):** memory,keys,find,glasses,wearable,remind,checklist,build,timelapse
- **Category:** Productivity (primary), Lifestyle (secondary)
- **Age rating:** 4+ expected (no objectionable content; camera/mic use
  is user-initiated). Confirm in the store questionnaires.

## Privacy policy (draft — host at your URL)

Memory Lens stores memories on your device. Photos are analyzed into
short written descriptions; only frames worth remembering keep their
photo, and private scenes are never photographed. If you connect your
own vision backend, frames you choose to analyze are sent to that
backend address — never anywhere else. The app has no accounts, no
analytics, no advertising, and no third-party tracking. Voice notes
you record are kept on the device; ambient microphone samples are
transcribed and the audio is deleted. You can review kept photos,
export your memories as text, or wipe any day at any time.

## Data-safety answers (Play) / App Privacy (Apple)

- Data collected: **none leaves the device by default.** Optional
  self-hosted backend receives: photos/clips the user triggers,
  transcribed text, recap text memories. No identifiers, no location,
  no contacts.
- Camera: capture for on-device memory + user-triggered analysis.
- Microphone: voice notes + optional transcription (user-enabled).
- Notifications: local only (no push, no remote entitlement).
- Storage: on-device SQLite + app document directory; user-controlled
  wipe/export.

## Screenshots to capture (physical device, development build)

1. Memory feed with a kept photo + "Where are my keys?" answer
2. Exit-check alert ("You left without your keys") + notification
3. Checklist progress (gig kit: seen / packed / missing)
4. Project step card with the 3D preview (current step orange)
5. Fast Capture event card ("clip analyzed")
6. Mic voice note in the feed; cartoon montage frame
Sizes: 6.7" iPhone + 6.5" Android phone minimum; add tablet if listing
for iPad (supportsTablet is on — decide or turn off before submit).

## Review notes for Apple/Google

- Demo without backend: Simulation source + offline mocks exercise
  every screen; no login exists or is required.
- RECORD_AUDIO: used only for user-recorded voice notes and POV video
  audio; no background recording.
- Camera: photo capture only in Memory/Project; continuous feeds come
  from user-supplied bridge URLs or paired Meta glasses.
