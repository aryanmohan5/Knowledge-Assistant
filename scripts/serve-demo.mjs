/**
 * Serves demo.html at http://localhost:5500 so it behaves like an external
 * site with its own origin. (A file:// page can't satisfy the assistant's
 * frame-ancestors policy.)  Usage: npm run demo [-- --port 5500]
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const portArg = process.argv.indexOf("--port");
const port = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.DEMO_PORT || 5500);
const demoPath = fileURLToPath(new URL("../demo.html", import.meta.url));

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (pathname !== "/" && pathname !== "/demo.html") {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  try {
    const html = await readFile(demoPath);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
  } catch {
    res.writeHead(500, { "content-type": "text/plain" }).end("demo.html not found");
  }
}).listen(port, () => {
  console.log(`Demo host site: http://localhost:${port}/demo.html?token=<assistant token>&app=http://localhost:3000`);
});
