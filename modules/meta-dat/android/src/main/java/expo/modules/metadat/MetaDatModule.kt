package expo.modules.metadat

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Base64
import android.util.Log
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.removeCamera
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.VideoFrame
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.types.DatResult
import com.meta.wearable.dat.core.types.Device
import com.meta.wearable.dat.core.types.DeviceCompatibility
import com.meta.wearable.dat.core.types.LinkState
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import com.meta.wearable.dat.display.addDisplay
import com.meta.wearable.dat.display.removeDisplay
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

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
// Frame pixel format, verified on Ray-Ban Meta hardware by
// decoding a captured raw frame offline: with compressVideo =
// false the frames are I420 (YUV420 planar: Y plane, then U
// plane, then V plane), tightly packed. Android's YuvImage wants
// NV21, so the converter below interleaves the chroma planes —
// reading the buffer as NV21 renders colours green/magenta.

class MetaDatModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var session: DeviceSession? = null
  private var frameJob: Job? = null
  private var sessionWatchJob: Job? = null
  private var pendingPermission: CompletableDeferred<PermissionStatus?>? =
    null
  private var lastSessionError: String? = null
  private var initialized = false

  private companion object {
    const val TAG = "MemoryLensMetaDat"
    const val PERMISSION_REQUEST_CODE = 9401
  }

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

  /**
   * The glasses link takes seconds to move CONNECTING -> CONNECTED
   * after the glasses wake, and the AutoDeviceSelector rejects every
   * device until then (NO_ELIGIBLE_DEVICE). Poll the metadata until a
   * device is session-eligible or the timeout lapses; the caller then
   * lets createSession produce the definitive answer either way.
   */
  private suspend fun awaitEligibleDevice(timeoutMs: Long = 30_000): Device? {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (true) {
      val eligible =
        Wearables.devices.value.firstNotNullOfOrNull { id ->
          Wearables.devicesMetadata[id]?.value?.takeIf { device ->
            device.linkState == LinkState.CONNECTED &&
              device.compatibility == DeviceCompatibility.COMPATIBLE
          }
        }
      if (eligible != null) return eligible
      if (System.currentTimeMillis() >= deadline) return null
      delay(500)
    }
  }

  /**
   * DeviceSession.start() connects asynchronously (STARTING ->
   * STARTED); adding a camera/display before STARTED is refused with
   * SESSION_ALREADY_STOPPED. Wait for the terminal state instead.
   */
  private suspend fun awaitSessionStarted(
    active: DeviceSession,
    timeoutMs: Long = 15_000,
  ) {
    if (active.state.value == DeviceSessionState.STARTED) return
    val reached =
      withTimeoutOrNull(timeoutMs) {
        active.state.first { it == DeviceSessionState.STARTED }
      }
    if (reached == null) {
      throw DatException(
        "Meta session did not finish starting (state=${active.state.value}, " +
          "last error: ${lastSessionError ?: "none"}). " +
          "Keep the glasses on and try again.",
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MemoryLensMetaDat")

    Events("onCameraFrame")

    // Registration returns to the app through a deep link intent.
    // Wearables.handleIntent throws WearablesException when the SDK was
    // never initialized in this process (e.g. an am-start relaunch intent)
    // — that exception is fatal on the main thread, so guard + contain.
    @Suppress("DEPRECATION")
    OnNewIntent { intent ->
      if (!initialized) return@OnNewIntent
      try {
        Wearables.handleIntent(intent) { /* request handled by SDK */ }
      } catch (ignored: Exception) {
        // Not a DAT intent or SDK not ready — never crash the host app.
      }
    }

    OnDestroy {
      frameJob?.cancel()
      session?.stop()
      session = null
    }

    // DAT device permissions (camera/microphone on the glasses) are
    // granted in the Meta AI app via the SDK's result contract. The
    // request function parks a deferred here; this completes it.
    OnActivityResult { _, payload ->
      if (payload.requestCode != PERMISSION_REQUEST_CODE) {
        return@OnActivityResult
      }
      val parsed =
        runCatching {
          Wearables.RequestPermissionContract()
            .parseResult(payload.resultCode, payload.data)
            .getOrNull()
        }
          .getOrNull()
      Log.d(TAG, "permission request finished: $parsed")
      pendingPermission?.complete(parsed)
      pendingPermission = null
    }

    AsyncFunction("configure") {
      initializeOnce()
    }

    AsyncFunction("startRegistration") {
      initializeOnce()
      val activity =
        appContext.currentActivity
          ?: throw DatException(
            "No foreground activity — open the app to register glasses.",
          )
      Wearables.startRegistration(activity)
    }

    AsyncFunction("checkPermission") Coroutine { kind: String ->
      initializeOnce()
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

    // Opens the Meta AI consent screen for glasses camera/microphone
    // access. Without this grant the camera stream starts and then
    // dies with PERMISSIONS_DENIED, so the adapter asks before it
    // streams. Resolves with the resulting status string.
    AsyncFunction("requestPermission") Coroutine { kind: String ->
      initializeOnce()
      val permission =
        if (kind == "microphone") Permission.MICROPHONE else Permission.CAMERA
      val current =
        Wearables.checkPermissionStatus(permission)
          .unwrap("Meta permission check failed")
      if (current == PermissionStatus.Granted) {
        "granted"
      } else {
        val activity =
          appContext.currentActivity
            ?: throw DatException(
              "No foreground activity — open the app to grant Meta permissions.",
            )
        val deferred = CompletableDeferred<PermissionStatus?>()
        pendingPermission?.cancel()
        pendingPermission = deferred
        Log.d(TAG, "requesting DAT permission: $permission")
        val intent =
          Wearables.RequestPermissionContract()
            .createIntent(activity, permission)
        @Suppress("DEPRECATION")
        activity.startActivityForResult(intent, PERMISSION_REQUEST_CODE)
        when (deferred.await()) {
          PermissionStatus.Granted -> "granted"
          PermissionStatus.Denied -> "denied"
          else -> "undetermined"
        }
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

    AsyncFunction("startSession") Coroutine { deviceId: String ->
      initializeOnce()
      session?.stop()
      sessionWatchJob?.cancel()
      val selector = AutoDeviceSelector()
      // Wait out the CONNECTING window: the selector throws
      // NO_ELIGIBLE_DEVICE while the glasses link is still coming up,
      // which reads to the user as "no glasses" seconds after waking
      // them. Log and continue either way so the error stays truthful.
      if (awaitEligibleDevice() == null) {
        Log.w(TAG, "no eligible device after wait; createSession decides")
      }
      val knownDevices =
        Wearables.devices.value.joinToString { id ->
          val meta = Wearables.devicesMetadata[id]?.value
          // Eligibility (AutoDeviceSelector) needs linkState==CONNECTED
          // and compatibility==COMPATIBLE; log every gate so a refusal
          // names its own reason instead of reading as "no glasses".
          "${id.identifier}(name=${meta?.name},battery=${meta?.batteryLevel}," +
            "link=${meta?.linkState},compat=${meta?.compatibility}," +
            "type=${meta?.deviceType},fw=${meta?.firmwareInfo}," +
            "don=${meta?.donState},hinge=${meta?.hingeState})"
        }
      Log.d(TAG, "startSession requested=$deviceId knownDevices=[$knownDevices]")
      val sessionResult = Wearables.createSession(selector)
      if (!sessionResult.isSuccess) {
        Log.w(
          TAG,
          "createSession failed: ${sessionResult.errorOrNull()} / ${sessionResult.exceptionOrNull()}",
        )
      }
      val created = sessionResult.unwrap("Meta session failed")
      created.start()
      session = created
      Log.d(TAG, "session started state=${created.state.value}")
      // Session connection is async: state/errors arrive on these flows.
      // Log them so NO_ELIGIBLE_DEVICE-style failures are diagnosable
      // from logcat instead of dying silently in the SDK.
      sessionWatchJob =
        scope.launch {
          launch {
            created.state.collect { state ->
              Log.d(TAG, "session state -> $state")
            }
          }
          launch {
            created.errors.collect { error ->
              // Kept so later failures can name the real cause (e.g.
              // DAT_APP_ON_THE_GLASSES_UPDATE_REQUIRED) instead of a
              // bare "session stopped".
              lastSessionError = error.toString()
              Log.w(TAG, "session error -> $error")
            }
          }
        }
      val activeId =
        runCatching { selector.activeDevice()?.identifier }.getOrNull()
      Log.d(TAG, "startSession activeDevice=$activeId")
      mapOf("deviceId" to (activeId ?: deviceId))
    }

    AsyncFunction("startCameraStream") Coroutine { config: Map<String, Any> ->
      val active =
        session
          ?: throw DatException("No Meta device session — connect first.")
      awaitSessionStarted(active)
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
      val cameraResult = active.addCamera(streamConfig)
      if (!cameraResult.isSuccess) {
        Log.w(
          TAG,
          "addCamera failed: ${cameraResult.errorOrNull()} / ${cameraResult.exceptionOrNull()}",
        )
      }
      val camera = cameraResult.unwrap("Meta camera unavailable")
      val cameraPermission =
        Wearables.checkPermissionStatus(Permission.CAMERA)
          .getOrNull()
      val micPermission =
        Wearables.checkPermissionStatus(Permission.MICROPHONE)
          .getOrNull()
      Log.d(
        TAG,
        "permissions camera=$cameraPermission microphone=$micPermission",
      )
      // Stream state/errors explain silent no-frame streams (channel
      // still negotiating, glasses camera busy); watch them alongside.
      scope.launch {
        launch { camera.state.collect { Log.d(TAG, "camera state -> $it") } }
        launch {
          camera.stream.state.collect {
            Log.d(TAG, "stream state -> $it")
          }
        }
        launch {
          camera.stream.errorStream.collect {
            Log.w(TAG, "stream error -> $it")
          }
        }
      }
      val startResult = camera.stream.start()
      if (!startResult.isSuccess) {
        Log.w(
          TAG,
          "stream.start failed: ${startResult.errorOrNull()} / ${startResult.exceptionOrNull()}",
        )
      }
      startResult.unwrap("Meta camera stream failed to start")
      Log.d(TAG, "camera stream started fps=$fps quality=$quality")
      frameJob?.cancel()
      frameJob =
        scope.launch {
          var frames = 0
          try {
            camera.stream.videoStream.collect { frame ->
              frames++
              if (frames == 1 || frames % 30 == 0) {
                Log.d(
                  TAG,
                  "video frame #$frames ${frame.width}x${frame.height} compressed=${frame.isCompressed}",
                )
              }
              val base64 =
                try {
                  frameToJpegBase64(frame)
                } catch (error: Exception) {
                  // One bad frame must not kill the stream collector.
                  Log.w(TAG, "frame convert failed: ${error.message}")
                  null
                }
              base64?.let {
                sendEvent("onCameraFrame", mapOf("base64" to it))
              }
            }
          } catch (error: Exception) {
            Log.w(TAG, "video stream collect ended: ${error.message}")
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
      awaitSessionStarted(active)
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
    awaitSessionStarted(active)
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

  /** I420 (Y, U plane, V plane) -> NV21 (Y, interleaved V/U). */
  private fun i420ToNv21(bytes: ByteArray, width: Int, height: Int): ByteArray {
    val ySize = width * height
    val chromaSize = ySize / 4
    if (bytes.size < ySize + 2 * chromaSize) return bytes
    val out = ByteArray(ySize + 2 * chromaSize)
    System.arraycopy(bytes, 0, out, 0, ySize)
    var i = 0
    while (i < chromaSize) {
      out[ySize + 2 * i] = bytes[ySize + chromaSize + i] // V
      out[ySize + 2 * i + 1] = bytes[ySize + i] // U
      i++
    }
    return out
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
    // Glasses deliver I420 planar (verified from a raw frame);
    // YuvImage decodes NV21, so interleave the chroma planes.
    val nv21 = i420ToNv21(bytes, frame.width, frame.height)
    val image =
      YuvImage(nv21, ImageFormat.NV21, frame.width, frame.height, null)
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
