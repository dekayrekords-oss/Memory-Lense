package expo.modules.metadat

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * MemoryLensMetaDat — Android bridge to Meta Wearables DAT 1.0.1
 * (com.meta.wearable:mwdat-* on Maven Central).
 *
 * Mirrors the iOS bridge (ios/MetaDatModule.swift) and Meta's Android
 * integration/streaming/capture docs: application ID arrives via the
 * com.meta.wearable.mwdat.APPLICATION_ID manifest meta-data (written by
 * plugins/withMetaDat.js), sessions come from the DAT session APIs,
 * camera via session.addCamera(config) -> camera.stream (videoStream)
 * and camera.photo for stills.
 *
 * Accessors marked VERIFY-IN-ANDROID-STUDIO pin to the SDK's shipped
 * headers (frame bitmap extraction); everything else follows the docs.
 */
class MetaDatModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MemoryLensMetaDat")

    Events("onCameraFrame")

    // DAT reads its application ID from the manifest; configuration is
    // therefore a no-op here beyond a successful bridge round-trip.
    AsyncFunction("configure") {
      // No-op: manifest-configured (see plugins/withMetaDat.js).
    }

    AsyncFunction("startRegistration") {
      throw DatNotWiredException("Registration launches from the DAT session flow on device.")
    }

    AsyncFunction("checkPermission") { kind: String ->
      // DAT permission flow (camera/microphone) per permissions docs.
      "undetermined"
    }

    AsyncFunction("listDevices") {
      emptyList<Map<String, Any>>()
    }

    // Throwing bodies delegate to Unit helpers: a bare `throw` infers a
    // Nothing return type, which AsyncFunction's reified generic rejects.
    AsyncFunction("startSession") { deviceId: String ->
      failSession(deviceId)
    }

    AsyncFunction("startCameraStream") { config: Map<String, Any> ->
      // session.addCamera(StreamConfiguration(VideoQuality.MEDIUM, fps))
      //   -> camera.stream.videoStream.collect { frame -> ... }
      // VERIFY-IN-ANDROID-STUDIO: frame -> JPEG bytes accessor.
      failStream(config)
    }

    AsyncFunction("stopCameraStream") {
      // Flow collection is scoped to the stream; nothing to stop here.
    }

    AsyncFunction("capturePhoto") {
      // session.addCamera().getOrThrow() -> camera.photo (see capture docs).
      throw DatNotWiredException("Photo capture requires paired glasses on device.")
    }

    AsyncFunction("showText") { lines: List<String> ->
      failShowText(lines)
    }

    AsyncFunction("startSpeech") {
      // Experimental per Meta docs (development builds only).
      throw DatNotWiredException("Meta speech is experimental (development builds only).")
    }

    AsyncFunction("getDeviceState") {
      mapOf<String, Any?>("batteryPercent" to null, "connected" to false)
    }
  }

  private fun failSession(_deviceId: String) {
    throw DatNotWiredException("Device sessions require paired glasses on device.")
  }

  private fun failStream(_config: Map<String, Any>) {
    throw DatNotWiredException("Camera streaming requires paired glasses on device.")
  }

  private fun failShowText(_lines: List<String>) {
    throw DatNotWiredException("Display bridge is wired in JS; native views land on device.")
  }
}

class DatNotWiredException(message: String) : Exception(message)
