export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isDesktop = isTauri;
export const ENGINE_WS_URL = "ws://localhost:9731";
export const ENGINE_HTTP_URL = "http://localhost:9731";
