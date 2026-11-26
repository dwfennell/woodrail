import { defineConfig, type Plugin } from "vitest/config";
import { gitShortHash, nativeBuild, updateCheckOn } from "./scripts/build-info.mjs";
import { debugReports } from "./scripts/debug-reports.mjs";
import { workerChunks } from "./scripts/worker-chunks.mjs";

// Names this build, so caches of things it generates (track piece geometry) are only reused by the same build, and so
// a running game can tell a newer deploy (version.json) from itself.
const BUILD_ID = Date.now().toString(36);

/** Writes version.json next to index.html, for the game's "New version" check. */
function versionFile(): Plugin {
  return {
    name: "woodrail-version-file",
    apply: "build",
    generateBundle() {
      const info = { build: BUILD_ID, commit: gitShortHash(), builtAt: new Date().toISOString() };
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(info) + "\n" });
    },
  };
}

/**
 * The Android/iOS app's page (docs/native-builds.md): it starts from `src/native/entry.ts`, which gets the saves back
 * from the app's own storage before the game reads them, and its fonts come with the app (no Google Fonts: it plays
 * offline).
 */
function nativePage(): Plugin {
  return {
    name: "woodrail-native-page",
    apply: "build",
    // (Before Vite bundles the page's script, so the native entry is what's bundled.)
    transformIndexHtml: {
      order: "pre",
      handler: (html) => {
        const out = html
          .replace('<script type="module" src="/src/main.ts"></script>', '<script type="module" src="/src/native/entry.ts"></script>')
          .replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>/, "")
          .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/, "");
        if (!out.includes("/src/native/entry.ts") || out.includes("fonts.googleapis.com")) throw new Error("native page: index.html's script or font tags have changed");
        return out;
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  // "Send to Claude" reports from the dev server, written to .reports/.
  plugins: [debugReports(), versionFile(), workerChunks(), ...(nativeBuild() ? [nativePage()] : [])],
  define: {
    __NATIVE__: nativeBuild() ? "true" : "false",
    // Empty in dev and tests: nothing is cached there.
    __BUILD_ID__: JSON.stringify(command === "build" ? BUILD_ID : ""),
    // The update check is for the deployed site: the artifact build (scripts/artifact-build.mjs) turns it off.
    __UPDATE_CHECK__: updateCheckOn() ? "true" : "false",
  },
  build: {
    // The icon font is its own file, never a data: URL (an artifact's page may not allow data: fonts).
    assetsInlineLimit: (file: string) => (file.endsWith(".woff2") ? false : undefined),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    // What the game loads on its own as it starts (the save's schemas, the track carving), loaded before each test file.
    setupFiles: ["src/test-setup.ts"],
  },
}));
