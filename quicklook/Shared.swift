// Shared by both Quick Look extensions: runs quicklook/render.js (on top of
// markdown-it's UMD build) in JavaScriptCore -- see "Quick Look preview" in
// docs/architecture-notes.md.
import Foundation
import JavaScriptCore

struct RenderError: Error, CustomStringConvertible {
    let description: String
}

final class MarkdownJS {
    private let context: JSContext
    private var jsError: String?

    init(bundle: Bundle) throws {
        guard let context = JSContext() else { throw RenderError(description: "JSContext() returned nil") }
        self.context = context
        context.exceptionHandler = { [weak self] _, exception in
            self?.jsError = exception?.toString() ?? "unknown JS exception"
        }
        for name in ["markdown-it.min", "render"] {
            guard let url = bundle.url(forResource: name, withExtension: "js") else {
                throw RenderError(description: "\(name).js missing from the appex bundle")
            }
            context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
            if let jsError { throw RenderError(description: "loading \(name).js: \(jsError)") }
        }
    }

    // Calls a global function in render.js that returns a string.
    func call(_ function: String, _ markdown: String) throws -> String {
        let result = context.objectForKeyedSubscript(function).call(withArguments: [markdown])
        if let jsError { throw RenderError(description: "\(function): \(jsError)") }
        guard let result, result.isString, let string = result.toString() else {
            throw RenderError(description: "\(function) returned a non-string")
        }
        return string
    }
}
