import { TERMS_TEXT } from "@/lib/terms"

// The source document only uses three block shapes: "## N. Title" headings,
// numbered-list runs (one "N. item" per line), and plain paragraphs.
type Block =
  | { kind: "h2"; text: string }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; text: string }

function parseBlocks(text: string): Block[] {
  return text.split(/\n\s*\n/).map((raw): Block => {
    const block = raw.trim()
    if (block.startsWith("## ")) return { kind: "h2", text: block.slice(3) }
    const lines = block.split("\n").map((l) => l.trim())
    if (lines.length > 0 && lines.every((l) => /^\d+\.\s/.test(l))) {
      return { kind: "ol", items: lines.map((l) => l.replace(/^\d+\.\s/, "")) }
    }
    return { kind: "p", text: block }
  })
}

const blocks = parseBlocks(TERMS_TEXT)

export function TermsBody() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((b, i) => {
        if (b.kind === "h2")
          return (
            <h2 key={i} className="pt-3 font-ui text-sm font-semibold uppercase tracking-wide text-foreground">
              {b.text}
            </h2>
          )
        if (b.kind === "ol")
          return (
            <ol key={i} className="list-decimal space-y-1 pl-6">
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ol>
          )
        return <p key={i}>{b.text}</p>
      })}
    </div>
  )
}
