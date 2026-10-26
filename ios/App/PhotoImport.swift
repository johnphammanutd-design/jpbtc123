import SwiftUI
import PhotosUI
import CoreTransferable
import UniformTypeIdentifiers

struct ImportedPhoto: Transferable, Sendable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Kairetic/Photo-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
            let file = folder.appendingPathComponent("selected." + received.file.pathExtension)
            do { try FileManager.default.copyItem(at: received.file, to: file); return ImportedPhoto(url: file) }
            catch { try? FileManager.default.removeItem(at: folder); throw error }
        }
    }
    func remove() { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
}
struct BoardBackdrop: View {
    let background: String
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                boardColor(background).opacity(0.16)
                if background.hasPrefix("url:/u/") {
                    AuthenticatedImage(path: String(background.dropFirst(4)))
                        .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                    Color(uiColor: .systemGroupedBackground).opacity(0.25)
                }
            }.frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }.ignoresSafeArea().accessibilityHidden(true).allowsHitTesting(false)
    }
}
