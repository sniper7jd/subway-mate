export function createMessageDeduplicator({ maxEntries = 5_000, ttlMs = 15 * 60 * 1_000 } = {}) {
  const seen = new Map();
  return (messageId) => {
    if (!messageId) return false;
    const now = Date.now();
    for (const [id, timestamp] of seen) {
      if (now - timestamp > ttlMs) seen.delete(id);
    }
    if (seen.has(messageId)) return true;
    if (seen.size >= maxEntries) seen.delete(seen.keys().next().value);
    seen.set(messageId, now);
    return false;
  };
}
