import type { Request, Response, NextFunction } from "express";
import { randomUUID, createHash } from "crypto";
import { recordRequest } from "../lib/metrics";
import { setRequestContext } from "../lib/sentry";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      startTimeMs: number;
    }
  }
}

function ipHash(ip: string | undefined): string {
  if (!ip) return "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function normalizeRoute(req: Request): string {
  const route = (req as Request & { route?: { path?: string }; baseUrl?: string }).route?.path;
  const baseUrl = req.baseUrl ?? "";
  if (route) return `${baseUrl}${route}`;
  return req.path.split("?")[0] ?? req.path;
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = incoming && /^[\w-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  req.startTimeMs = performance.now();
  res.setHeader("X-Request-ID", requestId);

  // Set Sentry scope at request start so any thrown error — handled or not —
  // carries the correct request context, not just successfully-completed ones.
  setRequestContext({
    requestId,
    userId: null,
    route: req.path.split("?")[0],
  });

  // Inject requestId into any error-shaped JSON body so route-local handlers
  // don't have to thread it through manually.
  const origJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (
      res.statusCode >= 400 &&
      body != null &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      !(body as Record<string, unknown>).requestId
    ) {
      const obj = body as Record<string, unknown>;
      if ("error" in obj || "code" in obj) {
        obj.requestId = requestId;
      }
    }
    return origJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    const durationMs = performance.now() - req.startTimeMs;
    const route = normalizeRoute(req);
    recordRequest(route, req.method, res.statusCode, durationMs);
    // Structured completion log line — the existing pino-http "request
    // completed" line will follow with full req/res serialization.
    req.log?.info(
      {
        requestId,
        userId: req.currentUser?.id ?? "anon",
        route,
        method: req.method,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        ipHash: ipHash(req.ip),
        ua: req.header("user-agent")?.slice(0, 200),
      },
      "request.completed",
    );
  });

  next();
}
