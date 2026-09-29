/** Retain only a digest and an opaque key, never the research payload. */
export async function mutationIntent(fingerprint: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(fingerprint),
  );
  const hash = [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const storageKey = `pico-intent:${hash}`;
  let key = crypto.randomUUID();
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved)
      key = saved as `${string}-${string}-${string}-${string}-${string}`;
    else sessionStorage.setItem(storageKey, key);
  } catch {
    /* In-memory retry still works if storage is unavailable. */
  }
  return {
    key,
    complete() {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
    },
  };
}
