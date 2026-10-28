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

Written against Meta's published integration/streaming/capture guides
(Oct 2026). Two accessors are marked `VERIFY-IN-XCODE` /
`VERIFY-IN-ANDROID-STUDIO` (frame/photo image extraction). Nothing here
has been compiled: this environment has no Xcode/Android Studio, no
Meta console project, and no glasses. Use Meta's Mock Device Kit to
develop without hardware once the module builds.
