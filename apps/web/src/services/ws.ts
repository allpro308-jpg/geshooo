import { authService } from "./auth.service";

// Build a same-origin WebSocket URL. In dev, Vite proxies /api to the backend;
// in production, Express serves the frontend and backend from the same host.
export function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${path}`;
}

export async function authenticatedWsUrl(path: string): Promise<string> {
  const { token } = await authService.wsToken();
  const url = new URL(wsUrl(path));
  url.searchParams.set("wsToken", token);
  return url.toString();
}
