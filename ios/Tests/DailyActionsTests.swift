import XCTest
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
@testable import KaireticCore

final class DailyActionsTests: XCTestCase {
    func json(_ value: String) throws -> JSON { try JSONDecoder().decode(JSON.self, from: Data(value.utf8)) }
    func testTemplateGalleryOnlyOffersLiveOriginalTemplates() throws {
        let snapshot = BoardSnapshot(try json(#"{"cards":[{"id":1,"is_template":1},{"id":2,"is_template":0},{"id":3,"is_template":1,"archived":1},{"id":4,"is_template":1,"mirror_of":1}]}"#))
        XCTAssertEqual(TemplateCards.available(in: snapshot).map(\.id), [1])
        let body = TemplateCards.copyBody(title: "  Công việc mới  ", listID: 7, keepMembers: false)
        XCTAssertEqual(body["title"]?.string, "Công việc mới"); XCTAssertEqual(body["list_id"]?.int, 7)
        XCTAssertFalse(body["members"]?.flag ?? true); XCTAssertTrue(body["checklists"]?.flag == true)
        XCTAssertNil(body["due_complete"]); XCTAssertNil(body["keep_template"])
    }
    func testQuickEditOnlySendsChangedFieldsAndClearsTimeWithDate() throws {
        let s = BoardSnapshot(try json(#"{"cards":[{"id":1,"title":"Kịch bản","due_date":"2026-10-31","due_time":"17:00","due_complete":1}],"labels":[{"id":8}],"cardLabels":[{"card_id":1,"label_id":8}]}"#))
        let original = QuickCardDraft(card: try XCTUnwrap(s.cards.first), snapshot: s)
        XCTAssertTrue(original.changes(from: original).isEmpty)
        var edited = original; edited.title = "  Kịch bản mới  "
        XCTAssertEqual(edited.changes(from: original), ["title": .string("Kịch bản mới")])
        edited.dueDate = ""; edited.dueTime = ""
        XCTAssertEqual(edited.changes(from: original)["due_date"], .string(""))
        XCTAssertEqual(edited.changes(from: original)["due_time"], .string(""))
        XCTAssertNil(edited.changes(from: original)["due_complete"])
    }
    func testQuickEditDetectsConcurrentChangesAndAllowsRetry() throws {
        let snapshot = BoardSnapshot(try json(#"{"cards":[{"id":1,"title":"Ban đầu"}]}"#))
        let original = QuickCardDraft(card: try XCTUnwrap(snapshot.cards.first), snapshot: snapshot)
        var proposed = original; proposed.title = "Nội dung của tôi"; proposed.labelIDs = [1]
        var someoneElse = original; someoneElse.title = "Nội dung từ máy khác"
        XCTAssertTrue(proposed.conflicts(with: someoneElse, original: original))
        var partialWrite = original; partialWrite.title = proposed.title
        XCTAssertFalse(proposed.conflicts(with: partialWrite, original: original))
        var labelConflict = partialWrite; labelConflict.labelIDs = [2]
        XCTAssertTrue(proposed.conflicts(with: labelConflict, original: original))
    }
    private func sampleImage(width: Int = 3200, height: Int = 240) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("kairetic-photo-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("sample.jpg")
        let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(CGColor(red: 0.1, green: 0.3, blue: 0.8, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let dest = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, try XCTUnwrap(context.makeImage()), [kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 10.0, kCGImagePropertyGPSLatitudeRef: "N"]] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(dest)); return url
    }
    func testPhotosBecomeBoundedJPEGSuitableForCurrentServer() async throws {
        let url = try sampleImage(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
        let sourceProperties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        XCTAssertNotNil(sourceProperties[kCGImagePropertyGPSDictionary])
        let result = try await PhotoPreparation.shared.prepare(url: url, maximumBytes: 10 * 1024 * 1024)
        XCTAssertLessThanOrEqual(max(result.width, result.height), 2560); XCTAssertLessThanOrEqual(result.data.count, 10 * 1024 * 1024)
        XCTAssertTrue(result.filename.hasSuffix(".jpg"))
        let decoded = try XCTUnwrap(CGImageSourceCreateWithData(result.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(decoded) as String?, UTType.jpeg.identifier)
        let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(decoded, 0, nil) as? [CFString: Any])
        XCTAssertNil(properties[kCGImagePropertyGPSDictionary])
    }
    func testPhotoRejectsInvalidAndUnreasonablySmallBudget() async throws {
        let url = try sampleImage(width: 32, height: 32); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        do { _ = try await PhotoPreparation.shared.prepare(url: url, maximumBytes: 1); XCTFail("Expected size rejection") }
        catch APIError.server(let code, _) { XCTAssertEqual(code, 413) }
        let invalid = url.deletingLastPathComponent().appendingPathComponent("invalid.jpg"); try Data("not an image".utf8).write(to: invalid)
        do { _ = try await PhotoPreparation.shared.prepare(url: invalid, maximumBytes: 1024); XCTFail("Expected image rejection") }
        catch APIError.server(let code, _) { XCTAssertEqual(code, 400) }
    }
}
