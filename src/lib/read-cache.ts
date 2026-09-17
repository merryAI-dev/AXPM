export function createReadCache<T>(ttlMs: number, maxEntries = 100) {
  const values = new Map<string, { value: T; expires: number }>();
  const inFlight = new Map<string, Promise<T>>();
  return async (
    key: string,
    load: () => Promise<T>,
    now = Date.now(),
  ): Promise<T> => {
    const cached = values.get(key);
    if (cached && cached.expires > now) return cached.value;
    const running = inFlight.get(key);
    if (running) return running;
    const request = load()
      .then((value) => {
        values.delete(key);
        values.set(key, { value, expires: Date.now() + ttlMs });
        while (values.size > maxEntries)
          values.delete(values.keys().next().value!);
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };
}
