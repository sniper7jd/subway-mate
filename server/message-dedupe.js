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

export function createReplyEchoGuard({ ttlMs = 60_000 } = {}) {
  const lastReply = new Map();
  return {
    remember(spaceId, text) {
      const normalized = String(text || "").trim();
      if (!spaceId || !normalized) return;
      lastReply.set(spaceId, { text: normalized, at: Date.now() });
    },
    isEcho(spaceId, text) {
      const entry = lastReply.get(spaceId);
      if (!entry) return false;
      if (Date.now() - entry.at > ttlMs) return false;
      return entry.text === String(text || "").trim();
    },
  };
}
