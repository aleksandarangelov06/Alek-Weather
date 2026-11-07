// fetch() has no timeout of its own: a request to a server that accepts the
// connection and then stalls (api.weather.gov does this under load) never
// settles, and anything awaiting it waits with it. Everything the forecast
// waits on goes through here so a slow source costs a bounded amount of time
// and then counts as failed, which every caller already handles.

// A signal that aborts after `ms`, or as soon as `parent` aborts, whichever is
// first. AbortSignal.any is missing on older WebViews; there the per-request
// timeout alone still applies.
export function deadline(ms, parent) {
  const timeout = AbortSignal.timeout(ms)
  if (!parent) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([parent, timeout]) : timeout
}

// fetch(url, init) that rejects with a TimeoutError after `ms`. The signal also
// covers reading the body, so `await res.json()` on a stalled body is bounded too.
export function fetchWithin(url, ms, init = {}) {
  return fetch(url, { ...init, signal: deadline(ms, init.signal) })
}
