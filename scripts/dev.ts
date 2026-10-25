import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { build } from "vite";
import { createLocalRuntime } from "./local-runtime";

await Promise.all(
  ["fixtures/vite", "fixtures/monorepo/apps/web"].map((root) =>
    build({ root, configFile: false, base: "./", build: { outDir: "dist" } }),
  ),
);
const runtime = await createLocalRuntime({ validate: true });
await runtime.login();
const preview = await runtime.mf.getWorker("preview");
const apiServer = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(", ") : value || "",
      ]),
    );
    const response = await runtime.mf.dispatchFetch(
      runtime.appOrigin + req.url,
      {
        method: req.method,
        headers,
        body: !["GET", "HEAD"].includes(req.method || "GET")
          ? Buffer.concat(chunks)
          : undefined,
      },
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
const previewServer = createServer(async (req, res) => {
  try {
    const response = await preview.fetch(runtime.previewOrigin + req.url, {
      method: req.method,
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503);
    res.end("Local fixture runtime unavailable");
  }
});
await Promise.all([
  new Promise<void>((r) => apiServer.listen(8787, "127.0.0.1", r)),
  new Promise<void>((r) => previewServer.listen(8788, "127.0.0.1", r)),
]);
const vite = await createViteServer({
  configFile: "apps/dashboard/vite.config.ts",
});
await vite.listen();
let ticking = false;
const timer = setInterval(() => {
  if (!ticking) {
    ticking = true;
    void runtime
      .tick()
      .catch(console.error)
      .finally(() => {
        ticking = false;
      });
  }
}, 400);
console.log("\nLOCAL FIXTURE MODE — no GitHub dispatch or cloud deployment.");
console.log(
  "Dashboard http://127.0.0.1:5173 · preview origin http://127.0.0.1:8788",
);
console.log(
  "Default local password: byga-local-fixture-only (override BYGA_LOCAL_PASSWORD).",
);
console.log(
  "Fixture URLs: https://github.com/fixture/html, /fixture/vite, /fixture/monorepo, /fixture/broken",
);
async function close() {
  clearInterval(timer);
  apiServer.close();
  previewServer.close();
  await vite.close();
  await runtime.dispose();
  process.exit(0);
}
process.on("SIGINT", () => {
  void close();
});
process.on("SIGTERM", () => {
  void close();
});
