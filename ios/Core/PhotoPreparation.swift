import Foundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

public struct PreparedPhoto: Sendable {
    public let data: Data
    public let filename: String
    public let width: Int
    public let height: Int
}
/// Decode a thumbnail off the main actor, apply orientation and export a compact, metadata-free JPEG.
public actor PhotoPreparation {
    public static let shared = PhotoPreparation()
    public func prepare(url: URL, maximumBytes: Int, maximumPixel: Int = 2560) throws -> PreparedPhoto {
        guard maximumBytes > 0, maximumPixel > 0 else { throw APIError.invalidResponse }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 100 * 1024 * 1024 else { throw APIError.server(413, "Không thể xử lý ảnh trống hoặc ảnh lớn hơn 100 MB. Hãy chọn ảnh khác.") }
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumPixel,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary),
              let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw APIError.server(400, "Không đọc được ảnh đã chọn. Hãy chọn một ảnh khác.") }
        context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: image.width, height: image.height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        guard let flattened = context.makeImage() else { throw APIError.invalidResponse }
        for quality in [0.88, 0.72, 0.55] {
            let data = NSMutableData()
            guard let output = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { throw APIError.invalidResponse }
            CGImageDestinationAddImage(output, flattened, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            guard CGImageDestinationFinalize(output) else { throw APIError.invalidResponse }
            if data.length <= maximumBytes {
                return PreparedPhoto(data: data as Data, filename: "Anh-\(CompanyClock.day(Date()))-\(UUID().uuidString.prefix(8)).jpg", width: flattened.width, height: flattened.height)
            }
        }
        throw APIError.server(413, "Ảnh vẫn quá lớn sau khi tối ưu. Hãy chọn ảnh nhỏ hơn.")
    }
}
