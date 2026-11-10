// Loaded only in the disposable preflight container. All other URLs use real fetch.
function wrap(fetch) {
  return function (input, init) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (url === "https://mdream.dev/cooldown-preflight.example/") {
      return Promise.resolve(new Response("preflight rate limit", { status: 429, headers: { "retry-after": "120" } }));
    }
    return fetch.call(this, input, init);
  };
}
// Next installs its own fetch wrapper at startup; retain the scoped intercept around it.
let activeFetch = wrap(globalThis.fetch);
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  get: () => activeFetch,
  set: (replacement) => { activeFetch = wrap(replacement); },
});
