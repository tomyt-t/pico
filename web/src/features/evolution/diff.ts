export type DiffSegment = { type: "same" | "ins" | "del"; text: string };

/** Beyond this many tokens on a side the diff is skipped; snapshots remain. */
export const diffTokenLimit = 4000;

/** Words with their trailing whitespace attached, so joining them restores the text. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

const word = (token: string) => token.trim();

/** Word-level diff of two texts, by longest common subsequence over
 *  whitespace-separated tokens. Returns null when a side exceeds the cap. */
export function diffWords(before: string, after: string): DiffSegment[] | null {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > diffTokenLimit || b.length > diffTokenLimit) return null;
  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment["type"], text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.type === type) last.text += text;
    else segments.push({ type, text });
  };
  // Common prefix and suffix keep the table small for the usual local edit.
  let start = 0;
  while (
    start < a.length &&
    start < b.length &&
    word(a[start] ?? "") === word(b[start] ?? "")
  )
    start++;
  let endA = a.length;
  let endB = b.length;
  while (
    endA > start &&
    endB > start &&
    word(a[endA - 1] ?? "") === word(b[endB - 1] ?? "")
  ) {
    endA--;
    endB--;
  }
  push("same", b.slice(0, start).join(""));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n && m) {
    // lengths[i * (m + 1) + j] = LCS length of midA[i..] and midB[j..].
    const width = m + 1;
    const lengths = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      const wa = word(midA[i] ?? "");
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * width + j] =
          wa === word(midB[j] ?? "")
            ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
            : Math.max(
                lengths[(i + 1) * width + j] ?? 0,
                lengths[i * width + j + 1] ?? 0,
              );
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      const ta = midA[i] ?? "";
      const tb = midB[j] ?? "";
      if (word(ta) === word(tb)) {
        push("same", tb);
        i++;
        j++;
      } else if (
        (lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0)
      ) {
        push("del", ta);
        i++;
      } else {
        push("ins", tb);
        j++;
      }
    }
    push("del", midA.slice(i).join(""));
    push("ins", midB.slice(j).join(""));
  } else {
    push("del", midA.join(""));
    push("ins", midB.join(""));
  }
  push("same", b.slice(endB).join(""));
  return segments;
}
