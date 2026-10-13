// Dev server only: "Send to Claude" reports (see src/debug/report.ts) land in `.reports/<time>/` (git-ignored), as
// report.json, save.json and view.webp, for the Claude session working on the game to read. Plain JS: this project
// has no Node types for the type-checker.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** @returns {import("vite").Plugin} */
export function debugReports() {
  return {
    name: "woodrail-debug-reports",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__woodrail/report", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const id = new Date().toISOString().replace(/[:.]/g, "-");
            const dir = join(server.config.root, ".reports", id);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, "report.json"), JSON.stringify(body.report, null, 2));
            writeFileSync(join(dir, "save.json"), JSON.stringify(body.save));
            if (body.picture) writeFileSync(join(dir, "view.webp"), Buffer.from(body.picture.replace(/^data:[^,]*,/, ""), "base64"));
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ id }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}
