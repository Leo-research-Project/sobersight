import ExpoModulesCore
import AVFoundation

// Controls the back-camera torch BRIGHTNESS (not just on/off) via
// AVCaptureDevice.setTorchModeOn(level:). Level is 0.0–1.0; values <= 0 turn the
// torch off. Works on the same physical device the camera session is using, so
// it can run alongside expo-camera recording.
public final class TorchLevelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TorchLevel")

    AsyncFunction("setLevel") { (level: Double) in
      try Self.applyTorch(level: Float(level))
    }
    .runOnQueue(.main)

    AsyncFunction("turnOff") {
      try Self.applyTorch(level: 0)
    }
    .runOnQueue(.main)
  }

  private static func applyTorch(level: Float) throws {
    guard let device = AVCaptureDevice.default(for: .video),
          device.hasTorch, device.isTorchAvailable else {
      throw TorchUnavailableException()
    }
    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }

    if level <= 0 {
      device.torchMode = .off
    } else {
      // setTorchModeOn throws if the level is outside (0, 1]; clamp to be safe.
      let clamped = min(max(level, 0.001), AVCaptureDevice.maxAvailableTorchLevel)
      try device.setTorchModeOn(level: clamped)
    }
  }
}

internal final class TorchUnavailableException: Exception {
  override var reason: String {
    "Torch is not available on this device"
  }
}
