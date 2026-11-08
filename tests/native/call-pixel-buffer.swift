import CoreVideo
import Foundation

@main struct PixelBufferTest {
  static func buffer(_ format: OSType, _ width: Int = 16, _ height: Int = 12) -> CVPixelBuffer {
    var value: CVPixelBuffer?
    precondition(CVPixelBufferCreate(kCFAllocatorDefault, width, height, format,
      [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &value) == kCVReturnSuccess)
    return value!
  }
  static func main() throws {
    let converter = CallPixelBufferConverter()
    let bgra = buffer(kCVPixelFormatType_32BGRA)
    let passthrough = try converter.convert(bgra)
    precondition(passthrough === bgra)
    for format in [kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange] {
      let source = buffer(format)
      CVPixelBufferLockBaseAddress(source, [])
      for plane in 0..<CVPixelBufferGetPlaneCount(source) {
        memset(CVPixelBufferGetBaseAddressOfPlane(source, plane), 128,
          CVPixelBufferGetBytesPerRowOfPlane(source, plane) * CVPixelBufferGetHeightOfPlane(source, plane))
      }
      CVPixelBufferUnlockBaseAddress(source, [])
      let result = try converter.convert(source)
      precondition(CVPixelBufferGetPixelFormatType(result) == kCVPixelFormatType_32BGRA)
      precondition(CVPixelBufferGetWidth(result) == 16 && CVPixelBufferGetHeight(result) == 12)
      CVPixelBufferLockBaseAddress(result, .readOnly)
      let pixel = CVPixelBufferGetBaseAddress(result)!.assumingMemoryBound(to: UInt8.self)
      precondition(pixel[3] == 255 && pixel[0] > 100 && pixel[0] < 160)
      precondition(abs(Int(pixel[0]) - Int(pixel[2])) < 4)
      CVPixelBufferUnlockBaseAddress(result, .readOnly)
      let reused = try converter.convert(source)
      precondition(reused === result)
      precondition(CVPixelBufferGetPixelFormatType(source) == format)
    }
    let resized = try converter.convert(buffer(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, 12, 16))
    precondition(CVPixelBufferGetWidth(resized) == 12 && CVPixelBufferGetHeight(resized) == 16)
    converter.reset()
    print("PASS: BGRA passthrough, full/video-range NV12 conversion, opaque gray pixels, buffer reuse, resize and reset")
  }
}
