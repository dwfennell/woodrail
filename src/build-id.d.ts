/** This build's id (see vite.config.ts); empty in dev and tests. */
declare const __BUILD_ID__: string;
/** Whether this build asks the site for a newer version (off in artifact builds). Only read where __BUILD_ID__ is set. */
declare const __UPDATE_CHECK__: boolean;
