// Finder Quick Look (spacebar) preview for .md files. Renders with the same
// markdown-it the editor parses with, via render.js in JavaScriptCore -- see
// "Quick Look preview" in docs/architecture-notes.md.
import Foundation
import JavaScriptCore
import QuickLookUI
import UniformTypeIdentifiers

struct RenderError: Error, CustomStringConvertible {
    let description: String
}

@objc(PreviewProvider)
class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let markdown = try String(contentsOf: request.fileURL, encoding: .utf8)
        let html = try render(markdown)
        return QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 800, height: 1000)) { _ in
            Data(html.utf8)
        }
    }

    private func render(_ markdown: String) throws -> String {
        guard let context = JSContext() else { throw RenderError(description: "JSContext() returned nil") }
        var jsError: String?
        context.exceptionHandler = { _, exception in jsError = exception?.toString() ?? "unknown JS exception" }

        let resources = Bundle(for: PreviewProvider.self)
        for name in ["markdown-it.min", "render"] {
            guard let url = resources.url(forResource: name, withExtension: "js") else {
                throw RenderError(description: "\(name).js missing from the appex bundle")
            }
            context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
            if let jsError { throw RenderError(description: "loading \(name).js: \(jsError)") }
        }

        let result = context.objectForKeyedSubscript("renderMarkdown").call(withArguments: [markdown])
        if let jsError { throw RenderError(description: "renderMarkdown: \(jsError)") }
        guard let html = result?.toString(), result?.isString == true else {
            throw RenderError(description: "renderMarkdown returned a non-string")
        }
        return html
    }
}
