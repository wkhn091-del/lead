/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the leads REST API. Unset means leads stay in this browser. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
