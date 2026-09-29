import type { Message } from "@pico/lab/contracts";

/** Keep loaded history as the live window moves, replacing updated tool calls. */
export function mergeMessages(
  previous: Message[],
  incoming: Message[],
  prepend = false,
): Message[] {
  return [
    ...new Map(
      (prepend ? [...incoming, ...previous] : [...previous, ...incoming]).map(
        (message) => [message.id, message],
      ),
    ).values(),
  ];
}

export function clearSubmittedDraft(
  current: string,
  submitted: string,
): boolean {
  return current === submitted;
}

export function hasHistoryGap(
  previous: Message[],
  incoming: Message[],
): boolean {
  if (!previous.length || !incoming.length) return false;
  const ids = new Set(previous.map((message) => message.id));
  return !incoming.some((message) => ids.has(message.id));
}

/** Bridge disjoint polling windows before publishing a joined timeline. */
export async function bridgeMessages(
  previous: Message[],
  incoming: Message[],
  readBefore: (id: string) => Promise<Message[]>,
): Promise<Message[]> {
  let contiguous = incoming;
  const cursors = new Set<string>();
  while (hasHistoryGap(previous, contiguous)) {
    const before = contiguous[0]?.id;
    if (!before || cursors.has(before)) throw new Error("HISTORY_GAP");
    cursors.add(before);
    const page = await readBefore(before);
    if (!page.length || page[0]?.id === before) throw new Error("HISTORY_GAP");
    contiguous = mergeMessages(contiguous, page, true);
  }
  return mergeMessages(previous, contiguous);
}

export function hasNewActivity(
  previousLastId: string | undefined,
  incoming: Message[],
): boolean {
  const next = incoming.at(-1)?.id;
  return next !== undefined && next !== previousLastId;
}
