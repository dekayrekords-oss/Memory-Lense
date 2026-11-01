# Release guide — Memory Lens

Everything between this repo and a store build. Items marked **[you]**
need your accounts or hardware; everything else is already in place.

## 1. One-time setup [you]

```bash
npm install -g eas-cli
eas login
cd memory-lens
eas init            # writes extra.eas.projectId into app.json
```

- iOS: Apple Developer Program membership; EAS can manage certificates
  and provisioning automatically (`eas credentials`).
- Android: a Google Play developer account plus a service-account JSON
  at `./play-service-account.json` (path already in `eas.json`).
- Fill the placeholders in `eas.json` → `submit.production`
  (`appleId`, `ascAppId`, `appleTeamId`) before submitting.

## 2. Builds

```bash
# Development build — required for Meta DAT native module + devices
eas build --profile development --platform ios
eas build --profile development --platform android
# iOS simulator variant (no Meta 3D/stream verification — GL unreliable)
eas build --profile development-simulator --platform ios

# Internal testing builds
eas build --profile preview --platform all

# Store builds
eas build --profile production --platform all
eas submit --platform all
```

Dev-client flow after installing a development build:

```bash
npx expo start        # scan the QR with the development build
```

## 3. Meta glasses (DAT) activation [you]

1. Create a project in the Meta Wearables Developer Center.
2. Copy app ID + client token into `app.json` → `extra.metaDat`
   (`plugins/withMetaDat.js` injects them natively).
3. iOS: open the generated project in Xcode → File → Add Package
   Dependencies → `https://github.com/facebook/meta-wearables-dat-ios`
   (v1.0.1), products `MWDATCore` + `MWDATCamera`. CocoaPods cannot
   consume the Swift Package; this step is manual per build machine.
   (Details: `modules/meta-dat/README.md`.)
4. Rebuild the development profile, pair glasses (developer mode skips
   the console app ID), then Memory tab → Meta → "Check Meta".

## 4. Background-capture limits (both OSes)

- iOS and Android both suspend continuous camera capture in the
  background. Memory Lens is **foreground-only**: capture, streaming,
  mic ambient sampling, and Fast Capture all run while the app is open.
- Local notifications still fire for alerts raised before backgrounding.
- Glasses/robot bridges keep their own clocks; the phone only needs to
  be awake while watching.
- Android: long mic-ambient sessions may need a foreground service for
  hours-long use — not shipped; sessions are sitting-length by design.

## 5. Device test checklist [you]

Development build on a physical phone (iOS simulator OpenGL is
unreliable for the 3D preview):

- [ ] Memory: phone capture → triage → "Where are my keys?" answers
- [ ] Exit / requirement / checklist alerts + notification arrives
- [ ] Meta source: status panel, frame stream, alert on lens display
- [ ] Generic glasses: `npm run stream -- ./frames 10 9000` → watch
- [ ] Mic: voice note transcribed; ambient sample stored as text
- [ ] Recaps: day + week cards render (backend and offline)
- [ ] Project: sheet → steps, 3D preview drag-rotates, verify a step,
      record POV clip, build timelapse
- [ ] Fast Capture: simulation event; `ws://` stream event; clip caption
- [ ] Retention: delete a photo, wipe today, export text
- [ ] Kill/restart: memories persist (SQLite), photos intact

## 6. Known pre-submission gaps

- Meta DAT (Android): module compiled, linked, and initialized on
  device (session attempt ends at `NO_ELIGIBLE_DEVICE` without
  registered glasses). Remaining hardware checks: raw frame pixel
  format (NV21 assumed in the converter), photo byte format, and a
  live stream against paired glasses with a console app ID. iOS:
  Swift bridge compiles only after the manual Xcode SPM step above.
- `ffmpeg` must exist on the vision server for montage/timelapse MP4s.
- Live AI paths need `VISION_API_KEY` (+ `TRANSCRIBE_MODEL` for mic).
