/**
 * Subsequence fuzzy match for short labels and paths (command palette).
 * Returns a score (higher is better) or -1 when `query` is not a
 * case-insensitive subsequence of `text`. Rewards contiguous runs, matches
 * at word / path / camelCase boundaries, and matches that fit entirely in
 * the last path segment (the file name).
 */
function subsequenceScore(q: string, text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const found = lower.indexOf(ch, from);
    if (found === -1) return -1;
    score += 1;
    if (found === prev + 1) score += 3;
    const before = found === 0 ? "/" : text[found - 1];
    const camel = /[a-z0-9]/.test(before) && /[A-Z]/.test(text[found]);
    if (camel || /[\s/._:\-]/.test(before)) score += 4;
    prev = found;
    from = found + 1;
  }
  return score;
}

export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const full = subsequenceScore(q, text);
  if (full === -1) return -1;
  const slash = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  const name = slash >= 0 ? subsequenceScore(q, text.slice(slash + 1)) : -1;
  // Shorter texts win ties.
  return Math.max(full, name === -1 ? -1 : name + 8) - text.length * 0.01;
}
