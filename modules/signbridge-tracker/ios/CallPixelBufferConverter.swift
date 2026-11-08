import CoreImage
import CoreVideo
import Foundation

/// Owned by the serial tracking worker. WebRTC commonly supplies NV12, while
/// MediaPipe's iOS MPImage requires BGRA. Never mutate the transmitted frame.
final class CallPixelBufferConverter {
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let colorSpace = CGColorSpaceCreateDeviceRGB()
  private var output: CVPixelBuffer?

  func reset() { output = nil }

  func convert(_ source: CVPixelBuffer) throws -> CVPixelBuffer {
    if CVPixelBufferGetPixelFormatType(source) == kCVPixelFormatType_32BGRA { return source }
    let width = CVPixelBufferGetWidth(source)
    let height = CVPixelBufferGetHeight(source)
    if output == nil || CVPixelBufferGetWidth(output!) != width || CVPixelBufferGetHeight(output!) != height {
      output = nil
      let attributes: [String: Any] = [
        kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
      ]
      let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height,
        kCVPixelFormatType_32BGRA, attributes as CFDictionary, &output)
      guard status == kCVReturnSuccess, output != nil else {
        throw NSError(domain: "SignBridgeTracker", code: Int(status),
          userInfo: [NSLocalizedDescriptionKey: "Could not prepare the call camera frame for sign recognition."])
      }
    }
    let destination = output!
    context.render(CIImage(cvPixelBuffer: source), to: destination,
      bounds: CGRect(x: 0, y: 0, width: width, height: height), colorSpace: colorSpace)
    return destination
  }
}
