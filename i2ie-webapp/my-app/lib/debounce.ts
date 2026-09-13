/**
 * Collapses a burst of calls into one trailing call. Needed anywhere a
 * live-events handler triggers a network refetch (see lib/socket.ts):
 * those handlers used to call MockEngine directly (an in-memory, genuinely
 * "cheap" read), so firing one per event was fine. Now every refetch is a
 * real HTTP + SQLite round trip — a burst of a few thousand events (e.g. a
 * bulk send across hundreds of valves) fires the same number of unthrottled
 * fetches otherwise, which is enough to exhaust the browser's own
 * connection pool (confirmed via stress-testing: ERR_INSUFFICIENT_RESOURCES).
 */
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}
