import { request } from "playwright";

const base = "http://127.0.0.1:20128";
const client = await request.newContext({ baseURL: base });
try {
  const login = await client.post("/api/auth/login", { data: { password: process.env.INITIAL_PASSWORD } });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const data = { provider: "mdream", format: "markdown", url: "https://cooldown-preflight.example/" };
  if (process.argv[2] === "before") {
    const first = await client.post("/api/search/fetch", { data });
    if (first.status() !== 429 || Number(first.headers()["retry-after"]) < 100) {
      throw new Error(`dashboard did not preserve upstream rate limit: ${first.status()}`);
    }
  }
  const created = await client.post("/api/keys", { data: { name: "preflight cooldown" } });
  if (!created.ok()) throw new Error(`test key creation failed: ${created.status()}`);
  const { key } = await created.json();
  if (typeof key !== "string" || !key) throw new Error("test key missing");
  const clientRoute = await client.post("/api/v1/web/fetch", {
    data, headers: { authorization: `Bearer ${key}` }
  });
  if (clientRoute.status() !== 429 || Number(clientRoute.headers()["retry-after"]) < 30) {
    throw new Error(`client route did not observe persisted cooldown: ${clientRoute.status()}`);
  }
  console.log(`Mdream shared cooldown verified (${process.argv[2]} restart)`);
} finally {
  await client.dispose();
}
