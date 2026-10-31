/** Shared passcode helpers (works in the proxy and route handlers). */
export const AUTH_COOKIE = "cm_auth";

export async function passToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`capmitra:${code}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
