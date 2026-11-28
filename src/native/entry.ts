// The Android/iOS app's start (docs/native-builds.md). The native build's index.html loads this instead of main.ts
// (vite.config.ts, `nativePage`): the saves are put back from the app's files before the game reads them, then the game
// starts.
import "@fontsource/nunito/500.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/lilita-one/400.css";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { installBackButton } from "./back";
import { mirror, restore } from "./durable";
import { fileDurable } from "./files";

async function keepSaves(): Promise<void> {
  try {
    const files = fileDurable();
    await restore(localStorage, files);
    const copy = mirror(localStorage, files);
    // Going to the background: the game saves then (main.ts, visibilitychange), and the copy is written straight after.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") setTimeout(() => void copy.flush(), 0);
    });
    void App.addListener("pause", () => setTimeout(() => void copy.flush(), 0));
  } catch {
    // No files: the game still has localStorage.
  }
}

async function start(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await keepSaves();
    installBackButton();
    // The table fills the screen; the HUD keeps clear of the notch and the home bar (safe-area insets, style.css).
    void StatusBar.hide().catch(() => undefined);
  }
  await import("../main");
}

void start();
