export function createLimiter(max, windowMs = 15 * 60 * 1000) {
  const buckets = new Map();
  function prune(list, now) {
    return list.filter((time) => now - time < windowMs);
  }
  return {
    isLimited(key) {
      const now = Date.now();
      const list = prune(buckets.get(key) || [], now);
      buckets.set(key, list);
      return list.length >= max;
    },
    hit(key) {
      const now = Date.now();
      const list = prune(buckets.get(key) || [], now);
      list.push(now);
      buckets.set(key, list);
      if (buckets.size > 5000) buckets.clear();
    },
    clear(key) {
      buckets.delete(key);
    },
  };
}
