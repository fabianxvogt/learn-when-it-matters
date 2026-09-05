import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const file of ["index.html", "styles.css", "app.js", "src"]) cpSync(join(root, file), join(dist, file), { recursive: true });
if (!existsSync(join(dist, "index.html")) || !existsSync(join(dist, "src", "core.js"))) throw new Error("Build output is incomplete");
writeFileSync(join(dist, "build-meta.json"), JSON.stringify({ version: "0.1.0", builtAt: new Date().toISOString() }, null, 2));
console.log(`Built static site to ${dist}`);
