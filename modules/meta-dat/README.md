# MemoryLensMetaDat (local Expo module)

Bridges Meta's **Wearables Device Access Toolkit (DAT) 1.0.1** to
Memory Lens. The JS surface is `src/services/metaDAT.ts` (100% of the
documented modules: core, camera, microphone, speakers, display,
speech, inputs, motion, device state); this package is the native half.

## Platform setup (required before a device build)

1. Create a project in the Meta Wearables Developer Center and copy its
   app ID + client token into `app.json` → `extra.metaDat`
   (`plugins/withMetaDat.js` writes them into native config).
2. **iOS**: the DAT ships as a Swift Package and cannot be consumed via
   CocoaPods. In the generated iOS project: Xcode → File → Add Package
   Dependencies → `https://github.com/facebook/meta-wearables-dat-ios`
   (v1.0.1), products `MWDATCore` + `MWDATCamera`. The Info.plist keys
   (app ID, client token, universal-link scheme) are written by the
   config plugin. Glasses in developer mode skip the app ID.
3. **Android**: dependencies are declared in `android/build.gradle`
   (`com.meta.wearable:mwdat-*:1.0.1`, Maven Central). The manifest
   `com.meta.wearable.mwdat.APPLICATION_ID` meta-data is written by the
   config plugin; analytics are opted out by default.
4. Build a development build (`eas build --profile development`) —
   Expo Go cannot load this module; the app degrades to the generic
   bridge with an on-screen reason when it is absent.

## Verification status

**Android: incorporated and device-verified up to the hardware
boundary.** The Kotlin module calls the real DAT 1.0.1 API
(`Wearables.initialize` once per process, `checkPermissionStatus`,
`createSession(AutoDeviceSelector)`, `session.addCamera` video
streams converted to JPEG, photo captures, lens display text). It
compiles (`:meta-dat:compileDebugKotlin`), links into the release
APK, and on a real phone the SDK initializes and a session attempt
ends at `NO_ELIGIBLE_DEVICE` — the exact expected state with no
registered glasses. The JS eyewear Meta source now connects (first
device) before streaming.

**Still required for a live stream:** a Meta Wearables console app
ID in `app.json → extra.metaDat` (or developer-mode glasses), a
paired device, and one hardware check — raw frame pixel format is
converted assuming NV21; if firmware sends another layout, only the
converter in `MetaDatModule.kt` changes.

**iOS:** the config plugin writes the Info.plist keys (verified via
`expo prebuild --platform ios`). The DAT Swift Package must still be
added in Xcode (File → Add Package Dependencies →
`github.com/facebook/meta-wearables-dat-ios`, products `MWDATCore` +
`MWDATCamera`) — CocoaPods cannot consume it, and the Swift bridge
compiles only after that step.
