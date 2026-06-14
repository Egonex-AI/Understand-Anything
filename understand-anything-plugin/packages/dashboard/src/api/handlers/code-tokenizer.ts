import jieba from "@node-rs/jieba"

/**
 * Tokenizer for code search. Handles CamelCase, snake_case, kebab-case,
 * dot/slash separators, number extraction, and CJK segmentation (jieba).
 * Used as MiniSearch's `tokenize` option.
 */
export function codeTokenize(text: string): string[] {
  if (!text.trim()) return []

  const tokens: string[] = []

  // CamelCase + consecutive uppercase splitting
  const parts = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./\\:,;()[\]{}'"]+/)

  for (const part of parts) {
    if (!part) continue
    const lower = part.toLowerCase()
    if (lower.length >= 2 && /^[\x00-\x7F]+$/.test(lower)) {
      tokens.push(lower)
    }
  }

  // Number extraction (2+ digits)
  const numbers = text.match(/\d{2,}/g)
  if (numbers) {
    for (const num of numbers) {
      tokens.push(num)
    }
  }

  // CJK segmentation via jieba
  const cjk = text.match(/[一-鿿㐀-䶿]+/g)
  if (cjk) {
    for (const segment of cjk) {
      try {
        const words = jieba.cut(segment, true)
        for (const word of words) {
          if (word.length > 0) tokens.push(word)
        }
      } catch (e) {
        console.warn("[code-tokenizer] jieba cut failed, falling back to bigram:", e)
        for (let i = 0; i < segment.length - 1; i++) {
          tokens.push(segment.slice(i, i + 2))
        }
        if (segment.length === 1) tokens.push(segment)
      }
    }
  }

  return tokens
}
