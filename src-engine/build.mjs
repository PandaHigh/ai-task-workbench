import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: resolve(__dirname, "dist/engine.js"),
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
  external: [],
  minify: false,
  sourcemap: true,
});

// Write a minimal package.json so Node.js recognizes engine.js as ESM
// This is needed both for Tauri resource dir and standalone deployment
writeFileSync(
  resolve(__dirname, "dist/package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n"
);

console.log("Engine bundled to dist/engine.js");
