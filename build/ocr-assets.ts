import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Serve the OCR engine and language from this website. Documents stay in the browser.
export function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const resolve = (name: string) => require.resolve(name, { paths: [process.cwd()] });
  const core = dirname(resolve("tesseract.js-core/package.json"));
  const files: Record<string, { path: string; mime: string }> = {
    "worker.min.js": {
      path: resolve("tesseract.js/dist/worker.min.js"),
      mime: "text/javascript",
    },
    "tesseract-core-lstm.wasm.js": {
      path: join(core, "tesseract-core-lstm.wasm.js"),
      mime: "text/javascript",
    },
    "tesseract-core-lstm.wasm": {
      path: join(core, "tesseract-core-lstm.wasm"),
      mime: "application/wasm",
    },
    "eng.traineddata.gz": {
      path: join(
        dirname(resolve("@tesseract.js-data/eng/package.json")),
        "4.0.0_best_int/eng.traineddata.gz",
      ),
      mime: "application/gzip",
    },
  };
  const pdfRoot = dirname(resolve("pdfjs-dist/package.json"));
  for (const [folder, source] of [
    ["fonts", "standard_fonts"],
    ["cmaps", "cmaps"],
    ["pdf-wasm", "wasm"],
  ]) {
    for (const name of readdirSync(join(pdfRoot, source))) {
      if (!/\.(?:ttf|pfb|bcmap|wasm|mjs|js)$/.test(name)) continue;
      files[`${folder}/${name}`] = {
        path: join(pdfRoot, source, name),
        mime: name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
      };
    }
  }
  return {
    name: "appointment-ocr-assets",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const name = req.url?.split("?")[0]?.replace(/^\/ocr\//, "");
        const file = req.url?.startsWith("/ocr/") && name ? files[name] : undefined;
        if (!file) return next();
        try {
          res.setHeader("Content-Type", file.mime);
          res.setHeader("Cache-Control", "public, max-age=86400");
          res.end(await readFile(file.path));
        } catch (error) {
          next(error as Error);
        }
      });
    },
    async generateBundle() {
      for (const [name, file] of Object.entries(files))
        this.emitFile({
          type: "asset",
          fileName: `ocr/${name}`,
          source: await readFile(file.path),
        });
    },
  };
}
