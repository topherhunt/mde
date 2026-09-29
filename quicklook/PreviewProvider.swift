// Finder Quick Look (spacebar) preview for .md files: renderMarkdown() in render.js
// turns the file into a standalone HTML page.
import Foundation
import QuickLookUI
import UniformTypeIdentifiers

@objc(PreviewProvider)
class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let markdown = try String(contentsOf: request.fileURL, encoding: .utf8)
        let html = try MarkdownJS(bundle: Bundle(for: PreviewProvider.self)).call("renderMarkdown", markdown)
        return QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 800, height: 1000)) { _ in
            Data(html.utf8)
        }
    }
}
