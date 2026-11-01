package expo.modules.metadat

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Base64
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.removeCamera
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.VideoFrame
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.types.DatResult
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import com.meta.wearable.dat.display.addDisplay
import com.meta.wearable.dat.display.removeDisplay
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

// MemoryLensMetaDat — Android bridge to Meta Wearables DAT 1.0.1
// (com.meta.wearable:mwdat-* on Maven Central).
//
// Real API usage, verified against the 1.0.1 artifacts:
// - Wearables.initialize(context) / startRegistration(activity)
// - Wearables.checkPermissionStatus(Permission) (suspend)
// - Wearables.createSession(AutoDeviceSelector()) -> DeviceSession;
//   session.start()/stop(); session.deviceInfo: StateFlow<Device>
// - session.addCamera(StreamConfiguration) -> Camera; camera.stream
//   .start(); stream.videoStream: Flow<VideoFrame>; camera.photo
//   .capturePhoto() -> photo.photoStream: Flow<PhotoCaptureData>
// - session.addDisplay() -> Display.sendContent { flexBox { text() } }
//
// Requires a Meta Wearables console app ID in
// com.meta.wearable.mwdat.APPLICATION_ID (written by
// plugins/withMetaDat.js) or glasses in developer mode. Without a
// registered device these calls fail with a DAT error that surfaces
// to JS as a rejection — expected until a console project exists.
//
// One accessor remains hardware-unverified: raw frame pixel format.
// With compressVideo = false, frames are converted NV21 -> JPEG
// (Android's standard camera YUV layout). If glasses firmware hands
// over another layout, only the converter below changes.

class MetaDatModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var session: DeviceSession? = null
  private var frameJob: Job? = null
  private var initialized = false

  private val reactContext
    get() =
      appContext.reactContext
        ?: throw DatException("No React context — module not attached.")

  /** Wearables.initialize fails with ALREADY_INITIALIZED on repeat calls. */
  private fun initializeOnce() {
    if (initialized) return
    Wearables.initialize(reactContext).unwrap("Meta DAT initialize failed")
    initialized = true
  }

  override fun definition() = ModuleDefinition {
    Name("MemoryLensMetaDat")

    Events("onCameraFrame")

    // Registration returns to the app through a deep link intent.
    @Suppress("DEPRECATION")
    OnNewIntent { intent ->
      Wearables.handleIntent(intent) { /* request handled by SDK */ }
    }

    OnDestroy {
      frameJob?.cancel()
      session?.stop()
      session = null
    }

    AsyncFunction("configure") {
      initializeOnce()
    }

    AsyncFunction("startRegistration") {
      val activity =
        appContext.currentActivity
          ?: throw DatException(
            "No foreground activity — open the app to register glasses.",
          )
      Wearables.startRegistration(activity)
    }

    AsyncFunction("checkPermission") Coroutine { kind: String ->
      val permission =
        if (kind == "microphone") Permission.MICROPHONE else Permission.CAMERA
      val status =
        Wearables.checkPermissionStatus(permission)
          .unwrap("Meta permission check failed")
      when (status) {
        PermissionStatus.Granted -> "granted"
        PermissionStatus.Denied -> "denied"
        else -> "undetermined"
      }
    }

    AsyncFunction("listDevices") {
      initializeOnce()
      Wearables.devices.value.map { id ->
        val device = Wearables.devicesMetadata[id]?.value
        mapOf(
          "id" to id.identifier,
          "name" to (device?.name ?: "Meta glasses"),
          "kind" to "glasses",
        )
      }
    }

    AsyncFunction("startSession") { deviceId: String ->
      initializeOnce()
      session?.stop()
      val selector = AutoDeviceSelector()
      val created =
        Wearables.createSession(selector).unwrap("Meta session failed")
      created.start()
      session = created
      val activeId =
        runCatching { selector.activeDevice()?.identifier }.getOrNull()
      mapOf("deviceId" to (activeId ?: deviceId))
    }

    AsyncFunction("startCameraStream") { config: Map<String, Any> ->
      val active =
        session
          ?: throw DatException("No Meta device session — connect first.")
      val fps = (config["fps"] as? Number)?.toInt() ?: 7
      val quality =
        when (config["resolution"] as? String) {
          "high" -> VideoQuality.HIGH
          "low" -> VideoQuality.LOW
          else -> VideoQuality.MEDIUM
        }
      val streamConfig =
        StreamConfiguration().copy(
          videoQuality = quality,
          frameRate = fps,
          compressVideo = false,
        )
      val camera =
        active.addCamera(streamConfig).unwrap("Meta camera unavailable")
      camera.stream.start().unwrap("Meta camera stream failed to start")
      frameJob?.cancel()
      frameJob =
        scope.launch {
          camera.stream.videoStream.collect { frame ->
            frameToJpegBase64(frame)?.let { base64 ->
              sendEvent("onCameraFrame", mapOf("base64" to base64))
            }
          }
        }
    }

    AsyncFunction("stopCameraStream") {
      frameJob?.cancel()
      frameJob = null
      session?.let { runCatching { it.removeCamera() } }
    }

    // Promise form: a parameterless `Coroutine {}` is ambiguous
    // between the () and (P0) builder overloads.
    AsyncFunction("capturePhoto") { promise: Promise ->
      scope.launch {
        try {
          promise.resolve(capturePhotoJpeg())
        } catch (error: Exception) {
          promise.reject(
            "DAT_CAPTURE_FAILED",
            error.message ?: "Meta photo capture failed.",
            error,
          )
        }
      }
    }

    AsyncFunction("showText") Coroutine { lines: List<String> ->
      val active =
        session
          ?: throw DatException("No Meta device session — connect first.")
      val display = active.addDisplay().unwrap("Meta display unavailable")
      try {
        display
          .sendContent {
            flexBox {
              lines.forEach { line -> text(line) }
            }
          }
          .unwrap("Meta display send failed")
      } finally {
        runCatching { active.removeDisplay() }
      }
    }

    AsyncFunction("startSpeech") {
      throw DatException(
        "Meta speech is experimental (development builds only).",
      )
    }

    AsyncFunction("getDeviceState") {
      val device = session?.deviceInfo?.value
      mapOf<String, Any?>(
        "batteryPercent" to
          device?.batteryLevel?.takeIf { it >= 0 },
        "connected" to (session != null),
      )
    }
  }

  private suspend fun capturePhotoJpeg(): Map<String, String> {
    val active =
      session ?: throw DatException("No Meta device session — connect first.")
    val camera =
      active.addCamera(StreamConfiguration()).unwrap("Meta camera unavailable")
    val photo = camera.photo
    val deferred = scope.async { photo.photoStream.first() }
    photo.capturePhoto()
    val captured =
      try {
        deferred.await()
      } catch (error: Exception) {
        throw DatException("Meta photo capture failed: ${error.message}")
      }
    return mapOf(
      "base64" to Base64.encodeToString(captured.imageData, Base64.NO_WRAP),
      "mimeType" to "image/jpeg",
    )
  }

  private fun frameToJpegBase64(frame: VideoFrame): String? {
    val buffer = frame.buffer.duplicate()
    val bytes = ByteArray(buffer.remaining())
    buffer.get(bytes)
    if (frame.isCompressed) {
      // Compressed stream requested off, but firmware may still send
      // encoded frames; the bridge payload is those bytes as-is.
      return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
    val image =
      YuvImage(bytes, ImageFormat.NV21, frame.width, frame.height, null)
    val out = ByteArrayOutputStream()
    val ok =
      image.compressToJpeg(Rect(0, 0, frame.width, frame.height), 70, out)
    if (!ok) return null
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}

private fun <T> DatResult<T, *>.unwrap(context: String): T {
  if (isSuccess) {
    return getOrNull()
      ?: throw DatException("$context: empty result.")
  }
  val detail =
    errorOrNull()?.toString()
      ?: exceptionOrNull()?.message
      ?: "unknown DAT error"
  throw DatException("$context: $detail")
}

class DatException(message: String) : Exception(message)
