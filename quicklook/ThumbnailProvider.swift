// Finder icon thumbnail for .md files: the document's opening text drawn large
// enough to skim (~27 characters per line), instead of macOS's generic plain-text
// thumbnail, which shrinks a whole page of raw source to unreadable texture.
import AppKit
import QuickLookThumbnailing

private struct Block: Decodable {
    let kind: String
    let text: String
    let checked: Bool?
    let n: String?
}

@objc(ThumbnailProvider)
class ThumbnailProvider: QLThumbnailProvider {
    override func provideThumbnail(for request: QLFileThumbnailRequest, _ handler: @escaping (QLThumbnailReply?, Error?) -> Void) {
        do {
            let markdown = try String(contentsOf: request.fileURL, encoding: .utf8)
            let json = try MarkdownJS(bundle: Bundle(for: ThumbnailProvider.self)).call("thumbnailBlocks", markdown)
            let blocks = try JSONDecoder().decode([Block].self, from: Data(json.utf8))

            // Portrait page (US Letter proportions) that fits the requested box.
            let max = request.maximumSize
            let size = max.height * 8.5 / 11 <= max.width
                ? CGSize(width: max.height * 8.5 / 11, height: max.height)
                : CGSize(width: max.width, height: max.width * 11 / 8.5)
            let text = try Self.attributedText(blocks, pageWidth: size.width)

            handler(QLThumbnailReply(contextSize: size) {
                NSColor.white.setFill()
                CGRect(origin: .zero, size: size).fill()
                let margin = size.width * 0.07
                text.draw(with: CGRect(origin: .zero, size: size).insetBy(dx: margin, dy: margin),
                          options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
                return true
            }, nil)
        } catch {
            handler(nil, error)
        }
    }

    private static func attributedText(_ blocks: [Block], pageWidth: CGFloat) throws -> NSAttributedString {
        let base = pageWidth * 0.075
        let out = NSMutableAttributedString()
        for block in blocks {
            var font = NSFont.systemFont(ofSize: base)
            var color = NSColor.black
            var text = block.text
            switch block.kind {
            case "h1": font = .boldSystemFont(ofSize: base * 1.35)
            case "h2": font = .boldSystemFont(ofSize: base * 1.2)
            case "h3", "h4", "h5", "h6": font = .boldSystemFont(ofSize: base)
            case "bullet": text = "• " + text
            case "ordered":
                guard let n = block.n else { throw RenderError(description: "ordered block without a number") }
                text = "\(n).  " + text
            case "task":
                text = (block.checked == true ? "☑ " : "☐ ") + text
                if block.checked == true { color = .gray }
            case "quote": color = .darkGray
            case "code": font = .monospacedSystemFont(ofSize: base * 0.85, weight: .regular); color = .darkGray
            default: break
            }
            let paragraph = NSMutableParagraphStyle()
            paragraph.paragraphSpacing = base * 0.35
            paragraph.lineBreakMode = .byWordWrapping
            out.append(NSAttributedString(string: text + "\n", attributes: [
                .font: font, .foregroundColor: color, .paragraphStyle: paragraph,
            ]))
        }
        return out
    }
}
