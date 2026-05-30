export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isDesktop = isTauri;

function detectEngineUrls(): { ws: string; http: string } {
  if (typeof window === "undefined") {
    return { ws: "ws://localhost:9731", http: "http://localhost:9731" };
  }
  const { protocol, hostname } = window.location;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    const wsProto = protocol === "https:" ? "wss:" : "ws:";
    return { ws: `${wsProto}//${hostname}`, http: `${protocol}//${hostname}` };
  }
  return { ws: "ws://localhost:9731", http: "http://localhost:9731" };
}

const urls = detectEngineUrls();
export const ENGINE_WS_URL = urls.ws;
export const ENGINE_HTTP_URL = urls.http;
