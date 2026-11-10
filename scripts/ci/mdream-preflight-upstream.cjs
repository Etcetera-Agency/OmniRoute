// Loaded only in the disposable preflight container. All other URLs use real fetch.
const realFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  if (url === "https://mdream.dev/cooldown-preflight.example/") {
    return Promise.resolve(new Response("preflight rate limit", { status: 429, headers: { "retry-after": "120" } }));
  }
  return realFetch.call(this, input, init);
};
