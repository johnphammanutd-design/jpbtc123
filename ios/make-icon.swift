import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let size = 1024
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(red: 0.11, green: 0.29, blue: 0.68, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: size, height: size))
for (i, height) in [440.0, 580.0, 340.0].enumerated() {
    let x = 172.0 + Double(i) * 242.0
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: i == 1 ? 1 : 0.88))
    context.addPath(CGPath(roundedRect: CGRect(x: x, y: 220, width: 196, height: height), cornerWidth: 36, cornerHeight: 36, transform: nil)); context.fillPath()
    context.setFillColor(CGColor(red: 0.55, green: 0.73, blue: 0.99, alpha: 1))
    context.addPath(CGPath(roundedRect: CGRect(x: x + 32, y: 220 + height - 85, width: 95, height: 21), cornerWidth: 10, cornerHeight: 10, transform: nil)); context.fillPath()
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, context.makeImage()!, nil)
precondition(CGImageDestinationFinalize(dest))
