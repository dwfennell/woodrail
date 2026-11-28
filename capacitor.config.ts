// The Android and iOS apps (docs/native-builds.md): Capacitor puts the native build (dist-native/) in a WebView.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // The store id: it can never change once the app is on Google Play or the App Store.
  appId: "io.github.dwfennell.woodrail",
  appName: "Woodrail",
  webDir: "dist-native",
  backgroundColor: "#cbbba3",
  android: {
    // Plain https://localhost (the default): the page is a secure context, as on the web.
    allowMixedContent: false,
  },
  ios: {
    contentInset: "never",
    // The table is the game's own scroll: no rubber-band bounce of the page.
    scrollEnabled: false,
  },
  plugins: {
    // Over as soon as the page is up: the game's own loading screen (index.html) takes it from there.
    SplashScreen: { launchShowDuration: 300, launchAutoHide: true, backgroundColor: "#cbbba3", showSpinner: false },
  },
};

export default config;
