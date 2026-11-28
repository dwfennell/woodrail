// The GitHub Pages copy as a home-screen app: a web manifest (`display: standalone`), its icons and the iPhone's own
// tags, so Woodrail added to a phone's home screen opens with no browser bars (an iPhone has no other way: a page can't
// go fullscreen there). Not in the artifact or itch builds (their `WOODRAIL_NO_UPDATE_CHECK`), where the page lives
// inside someone else's frame. Icons: src/assets/app-icons (tools/shots/app-icons.mjs). The HUD offers it in ☰ on an
// iPhone where the page has its manifest (`homeScreenOffered`, src/ui/fullscreen.ts).
import { readFileSync } from "node:fs";
import { updateCheckOn } from "./build-info.mjs";

const ICONS = new URL("../src/assets/app-icons/", import.meta.url);

// (Paths relative to the manifest, which sits beside index.html: right under any base, /woodrail/ on Pages.)
const MANIFEST = {
  name: "Woodrail",
  short_name: "Woodrail",
  description: "Build a wooden toy railway and run trains between little towns.",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#cbbba3",
  theme_color: "#cbbba3",
  icons: [
    { src: "app/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

/** The files beside index.html: the manifest and the icons, by path. */
function files() {
  const out = new Map([180, 192, 512].map((size) => [`app/icon-${size}.png`, readFileSync(new URL(`icon-${size}.png`, ICONS))]));
  out.set("manifest.webmanifest", JSON.stringify(MANIFEST, null, 2) + "\n");
  return out;
}

/** @returns {import("vite").Plugin} */
export function homeScreenApp() {
  return {
    name: "woodrail-home-screen",
    apply: () => updateCheckOn(),
    // The dev server serves them too: the e2e's iPhone checks the ☰ item that offers it, and the manifest it reads.
    configureServer(server) {
      const served = files();
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0].replace(/^\//, "");
        const f = served.get(path);
        if (!f) return next();
        res.setHeader("Content-Type", path.endsWith(".png") ? "image/png" : "application/manifest+json");
        res.end(f);
      });
    },
    generateBundle() {
      for (const [fileName, source] of files()) this.emitFile({ type: "asset", fileName, source });
    },
    transformIndexHtml: {
      order: "post",
      handler: () => {
        const tag = (tag, attrs) => ({ tag, attrs, injectTo: "head" });
        return [
          tag("link", { rel: "manifest", href: "./manifest.webmanifest" }),
          tag("link", { rel: "apple-touch-icon", href: "./app/icon-180.png" }),
          // Opened from the home screen: no browser bars, the phone's clock drawn over the game's top (the HUD keeps
          // clear of it by env(safe-area-inset-top)).
          tag("meta", { name: "apple-mobile-web-app-capable", content: "yes" }),
          tag("meta", { name: "mobile-web-app-capable", content: "yes" }),
          tag("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" }),
          tag("meta", { name: "apple-mobile-web-app-title", content: "Woodrail" }),
        ];
      },
    },
  };
}
