/// <reference types="vite/client" />

/**
 * Build-time variables read through `import.meta.env`. Vite replaces them while building, so a
 * variable that is not set is `undefined` at runtime: compare with `=== '1'`, never rely on truthiness
 * of the raw string.
 */
interface ImportMetaEnv {
  /** `'1'` in the GitHub Pages demo build (no server, example data). */
  readonly VITE_DEMO?: string
  /** `'1'` in the standalone Capacitor app (no server, data on the device). */
  readonly VITE_MOBILE?: string
  /** Base URL of the exercise images in builds that have no media server (mobile). */
  readonly VITE_IMG_BASE?: string
  /** Base URL of the exercise GIFs in builds that have no media server (mobile). */
  readonly VITE_GIF_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
