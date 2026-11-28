# Android and iOS apps

The game ships as an Android app (Google Play first) and an iOS app (the App Store later: its $99 a year waits until
the Android app shows there's an audience). Both are the web game in a WebView, by [Capacitor](https://capacitorjs.com):
`android/` and `ios/` are Capacitor's projects, made from the same build.

- **Store id**: `io.github.dwfennell.woodrail` (`capacitor.config.ts`). It can't change once the app is on a store.
- **Audience**: everyone, not a kids' app. Don't pick the Kids category (App Store) or list under-13s as a target age
  (Google Play's Families policy): both would rule out the opt-in play stats and the links out.
- **Store words**: a wooden toy railway. Never name a toy brand in the listing, keywords, screenshots or the game.

## Building

```sh
npm run build:native          # dist-native/, then `npx cap sync` copies it into android/ and ios/
npm run native:android        # build, then run on a device or emulator (`npx cap run android`)
npm run native:ios            # build, then run on a simulator or iPhone (`npx cap run ios`)
npx cap open android          # Android Studio; `npx cap open ios`: Xcode
```

Android needs JDK 21 and the Android SDK (`JAVA_HOME`, `ANDROID_HOME`). Without Android Studio:
`brew install openjdk@21 android-commandlinetools`, then
`sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "emulator" "system-images;android-36;google_apis;arm64-v8a"`
and `avdmanager create avd -n woodrail-pixel -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_9` for an
emulator (set `hw.gpu.mode=host` in its `config.ini`).

iOS needs Xcode with its iOS platform installed (Xcode → Settings → Components, or `xcodebuild -downloadPlatform iOS`:
an Xcode newer than its simulators refuses to build without it). From a script or an agent, give `xcodebuild`
`-packageAuthorizationProvider netrc` (and `swift package resolve` `--disable-keychain`): Swift Package Manager otherwise
asks the keychain about GitHub before it downloads Capacitor's frameworks, and with no one to answer it waits for ever.

The icon and splash: `node tools/shots/app-icon.mjs` draws the title's W block into `assets/`, and
`npx capacitor-assets generate --android --ios --iconBackgroundColor '#cbbba3' --splashBackgroundColor '#cbbba3'` makes
every size into the projects.

## How the build differs

- **Relative paths**, **no update check** and no `version.json`: the store updates the app.
- **No cloud saves**: the app's page is `capacitor://localhost` (iOS) or `https://localhost` (Android), the same in every
  Capacitor app, so the Worker can't tell ours from another's (itch's reason too). Feedback, crash reports and play
  stats go to the Worker, which lets those origins in for them alone (`cloud/src/index.ts`, `APP_ORIGINS`). Its address
  is `VITE_STATS_URL`, or else the repo's `WOODRAIL_CLOUD_URL` variable (`gh variable get`: the apps are built here,
  not by a workflow); with neither, the build says loudly that it sends nothing. Play stats name the place played
  `android` or `ios` (`pageStats`), so the Activity dashboard counts them (it leaves out `local`, the dev server).
- **The page starts at `src/native/entry.ts`** (vite.config.ts's `nativePage`, only when `WOODRAIL_NATIVE` is set), and
  `__NATIVE__` is true. Before the game reads its saves:
  - **Saves are copied to the app's files** (`src/native/durable.ts`, `files.ts`). The OS may clear a WebView's
    localStorage when the phone is short of space; it never clears the app's data folder. Every `woodrail.` key is
    copied there a moment after it's written, and at once when the app goes to the background; at start, a key
    localStorage has lost is put back. (Checked on the emulator: a game kept after its WebView storage was wiped.)
  - **Android's Back** is Esc (`src/native/back.ts`): it puts away the menu, a card or a sheet, and with nothing to put
    away sends the app to the background. Never a page back.
  - **The fonts come with the app** (`@fontsource/nunito`, `@fontsource/lilita-one`), not from Google Fonts: it plays
    offline.
  - The status bar is hidden; the HUD keeps clear of the notch and the home bar by the safe-area insets, as on the web.
    On Android, a WebView older than 140 is set in from the system bars, and the window behind is the table's colour
    (`android/app/src/main/res/values/colors.xml`).
  - The menu has no Fullscreen (`fullscreenAvailable`). Links out (the wiki, credits) open the phone's browser.

## Releasing on Google Play

One-time:

1. A Google Play developer account ($25 once), with identity verification.
2. An upload key: `keytool -genkey -v -keystore woodrail-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`.
   Keep it in 1Password, never in the repo. Play App Signing holds the real signing key.
3. In Play Console: the app, its store listing (icon `assets/icon-only.png`, a 1024×500 feature graphic, phone
   screenshots), the privacy policy link, the Data safety form (play stats and crash reports: anonymous, opt-in; feedback:
   what the player types), the IARC content rating, and the target audience (13 and over is the simplest; not the
   Families program).
4. **A new personal account must run a closed test with at least 12 testers for 14 days** before it can publish to
   production. Start it early.

Each release: bump `versionCode` and `versionName` in `android/app/build.gradle`, `npm run build:native`, then
`cd android && ./gradlew bundleRelease` (signed with the upload key) and upload the `.aab` from
`android/app/build/outputs/bundle/release/`.

## Later: the App Store

When the Android app has shown there's an audience: the Apple Developer Program ($99 a year), the app in App Store
Connect, its privacy label and age rating, TestFlight, then review. The iOS project builds and runs in the simulator
today; set the team in Xcode's Signing & Capabilities to run it on an iPhone.
