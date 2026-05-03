import type { Response } from "express";

export function sendUnauthenticated(res: Response, message = "Authentication required"): void {
  res.setHeader("WWW-Authenticate", 'Bearer realm="api", error="invalid_token"');
  res.status(401).json({ code: "UNAUTHENTICATED", error: message });
}

export function sendForbidden(res: Response, message = "Forbidden"): void {
  res.status(403).json({ code: "FORBIDDEN", error: message });
}
