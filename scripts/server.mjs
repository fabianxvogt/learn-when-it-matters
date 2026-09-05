import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

const server = createServer((request, response) => {
  const requested = request.url?.split("?")[0] || "/";
  const safePath = normalize(requested).replace(/^([.][.][/\\])+/, "");
  let file = join(root, safePath === "/" ? "index.html" : safePath);
  if (!existsSync(file) || !statSync(file).isFile()) file = join(root, "index.html");
  response.writeHead(200, { "Content-Type": types[extname(file)] || "text/plain", "Cache-Control": "no-store" });
  createReadStream(file).pipe(response);
});

server.listen(port, "127.0.0.1", () => console.log(`Learn When It Matters running at http://127.0.0.1:${port}`));
