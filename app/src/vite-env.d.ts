/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional, build-time only, never committed (see /.env.example).
   * Prefills the OpenRouter key field in AI settings for your own personal
   * builds so you don't have to paste it every time. Still requires hitting
   * "Save connection" — never silently persisted. Anyone else building this
   * repo without their own .env.local sees an empty field, same as today.
   */
  readonly VITE_OPENROUTER_DEFAULT_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
