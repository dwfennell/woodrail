/// <reference types="vite/client" />

/** A worker module's URL, built as a chunk of the page's own build (scripts/worker-chunks.mjs). */
declare module "*?worker-chunk" {
  const url: string;
  export default url;
}
