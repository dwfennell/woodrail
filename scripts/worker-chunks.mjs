// Workers as chunks of the page's own build (`import url from "./x-worker.ts?worker-chunk"`), so they share its chunks
// (three, the track carving, the simplifier) instead of each carrying its own copies, as Vite's separate worker builds
// do. In the dev server and tests the URL is the module's own (served as it is).
import { relative } from "node:path";

const SUFFIX = "?worker-chunk";
const PREFIX = "\0worker-chunk:";

/** @returns {import("vite").Plugin} */
export function workerChunks() {
  let build = false;
  let root = process.cwd();
  return {
    name: "woodrail-worker-chunks",
    enforce: "pre",
    configResolved(c) {
      build = c.command === "build";
      root = c.root;
    },
    async resolveId(id, importer) {
      if (!id.endsWith(SUFFIX)) return null;
      const r = await this.resolve(id.slice(0, -SUFFIX.length), importer, { skipSelf: true });
      return r ? PREFIX + r.id : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length);
      if (!build) return `export default ${JSON.stringify("/" + relative(root, file).split("\\").join("/"))};`;
      const ref = this.emitFile({ type: "chunk", id: file });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
  };
}
