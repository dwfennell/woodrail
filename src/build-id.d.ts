/** This build's id (see vite.config.ts); empty in dev and tests. */
declare const __BUILD_ID__: string;
/** Whether this build asks the site for a newer version (off in artifact builds). Only read where __BUILD_ID__ is set. */
declare const __UPDATE_CHECK__: boolean;
/** Whether this is the Android/iOS app's build (scripts/native-build.mjs, docs/native-builds.md). */
declare const __NATIVE__: boolean;
