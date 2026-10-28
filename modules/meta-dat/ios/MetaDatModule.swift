import ExpoModulesCore
import MWDATCore
import MWDATCamera

// MemoryLensMetaDat — iOS bridge to Meta Wearables DAT 1.0.1.
//
// API usage follows Meta's iOS integration + streaming + capture docs
// (wearables.developer.meta.com/docs/develop/dat): Wearables.configure(),
// Wearables.shared.startRegistration(), checkPermissionStatus(.camera),
// createSession(deviceSelector:) with AutoDeviceSelector, session.start(),
// session.addCamera(config:) -> camera.stream (videoFramePublisher),
// camera.photo for stills.
//
// The DAT Swift Package (github.com/facebook/meta-wearables-dat-ios)
// must be added to the generated iOS project in Xcode (File > Add
// Package Dependencies) — CocoaPods cannot consume SPM packages, so
// `pod install` alone will not resolve MWDAT* imports. See README.
//
// Accessors marked VERIFY-IN-XCODE pin to the SDK's shipped headers;
// they are the two spots Meta's guides describe without spelling the
// exact property (frame/photo image extraction).

public class MetaDatModule: Module {
  private var wearables: Wearables.Type { Wearables.self }
  private var session: DeviceSession?
  private var frameToken: Any?
  private var stateToken: Any?

  public func definition() -> ModuleDefinition {
    Name("MemoryLensMetaDat")

    Events("onCameraFrame")

    AsyncFunction("configure") {
      // One-time SDK setup; app ID/client token come from Info.plist,
      // written by plugins/withMetaDat.js from app.json extra.metaDat.
      try Wearables.configure()
    }

    AsyncFunction("startRegistration") {
      try await Wearables.shared.startRegistration()
    }

    AsyncFunction("checkPermission") { (kind: String) -> String in
      let permission: Permission = kind == "microphone" ? .microphone : .camera
      let status = try await Wearables.shared.checkPermissionStatus(permission)
      switch status {
      case .granted: return "granted"
      case .denied: return "denied"
      default: return "undetermined"
      }
    }

    AsyncFunction("listDevices") { () -> [[String: Any]] in
      // devicesStream() is an async sequence; take the first snapshot.
      for await devices in Wearables.shared.devicesStream() {
        return devices.map { device in
          [
            "id": String(describing: device.identifier),
            "name": device.name ?? "Meta glasses",
            "kind": "glasses",
          ]
        }
      }
      return []
    }

    AsyncFunction("startSession") { (deviceId: String) -> [String: String] in
      let selector = AutoDeviceSelector(wearables: Wearables.shared)
      let created = try await Wearables.shared.createSession(deviceSelector: selector)
      try created.start()
      self.session = created
      return ["deviceId": deviceId]
    }

    AsyncFunction("startCameraStream") { (config: [String: Any]) in
      guard let session = self.session else {
        throw DatException.noSession
      }
      let fps = (config["fps"] as? Int) ?? 15
      let resolutionName = (config["resolution"] as? String) ?? "medium"
      let resolution: StreamingResolution =
        resolutionName == "high" ? .high : resolutionName == "low" ? .low : .medium
      let streamConfig = StreamConfiguration(
        videoCodec: VideoCodec.raw,
        resolution: resolution,
        frameRate: fps
      )
      guard let camera = try session.addCamera(config: streamConfig) else {
        throw DatException.cameraUnavailable
      }
      let stream = camera.stream
      self.frameToken = stream.videoFramePublisher.listen { [weak self] frame in
        // VERIFY-IN-XCODE: frame.makeUIImage() is from Meta's streaming
        // guide; JPEG extraction for the bridge payload.
        guard let image = frame.makeUIImage(),
              let data = image.jpegData(compressionQuality: 0.7) else { return }
        self?.sendEvent("onCameraFrame", ["base64": data.base64EncodedString()])
      }
      self.stateToken = stream.statePublisher.listen { _ in }
      stream.start()
    }

    AsyncFunction("stopCameraStream") {
      // Stream stops with its camera/session; tokens are simply dropped.
      self.frameToken = nil
      self.stateToken = nil
    }

    AsyncFunction("capturePhoto") { () -> [String: String] in
      guard let session = self.session else {
        throw DatException.noSession
      }
      guard let camera = try session.addCamera() else {
        throw DatException.cameraUnavailable
      }
      let photo = camera.photo
      // capturePhoto is the documented still entry point; the result's
      // image accessor is the VERIFY-IN-XCODE spot (JPEG Data payload).
      let captured = try await photo.capturePhoto()
      let data = captured.jpegData ?? Data()
      return [
        "base64": data.base64EncodedString(),
        "mimeType": "image/jpeg",
      ]
    }

    AsyncFunction("showText") { (_: [String]) in
      // Display module (MWDATDisplay): session display views per Meta's
      // display guides. Kept as a bridge so JS owns the surface; the
      // view construction lands with the on-device display work.
      throw DatException.displayUnwired
    }

    AsyncFunction("startSpeech") {
      // Experimental per Meta docs (dev builds only).
      throw DatException.experimentalSpeech
    }

    AsyncFunction("checkPermissionStatus") { (kind: String) -> String in
      let permission: Permission = kind == "microphone" ? .microphone : .camera
      let status = try await Wearables.shared.checkPermissionStatus(permission)
      switch status {
      case .granted: return "granted"
      case .denied: return "denied"
      default: return "undetermined"
      }
    }

    AsyncFunction("getDeviceState") { () -> [String: Any] in
      return [
        "batteryPercent": NSNull(),
        "connected": self.session != nil,
      ]
    }
  }
}

enum DatException: Error {
  case noSession
  case cameraUnavailable
  case displayUnwired
  case experimentalSpeech

  var reason: String {
    switch self {
    case .noSession: return "No Meta device session — connect first."
    case .cameraUnavailable: return "Meta camera unavailable (session not started)."
    case .displayUnwired: return "Meta display bridge is wired in JS; native views land on device."
    case .experimentalSpeech: return "Meta speech is experimental (development builds only)."
    }
  }
}
