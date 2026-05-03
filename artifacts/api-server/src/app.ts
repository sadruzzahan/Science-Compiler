import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { attachUser } from "./middlewares/auth";
import { requestContextMiddleware } from "./middlewares/requestContext";
import router from "./routes";
import webhooksRouter from "./routes/webhooks";
import { generalRateLimit } from "./lib/rateLimits";
import { logger } from "./lib/logger";
import { captureException, setupSentryErrorHandler } from "./lib/sentry";

const app: Express = express();

// requestContext must come first so every downstream middleware (including
// pino-http) sees req.requestId and the X-Request-ID header is set even on
// early errors.
app.use(requestContextMiddleware);

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as Request).requestId,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Clerk proxy must be mounted before body parsers (streams raw bytes).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Webhooks must be mounted with raw body parser before express.json().
// Apply the general limiter here too so the webhook surface gets the same
// abuse protection as the rest of /api (Task #11 — limiter coverage).
app.use("/api", generalRateLimit, webhooksRouter);

app.use(cors({ credentials: true, origin: true, exposedHeaders: ["X-Request-ID"] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use(attachUser);
app.use("/api", router);

// Sentry must run BEFORE our central handler so its instrumentation captures
// the unhandled error first; our handler still emits the user-visible JSON.
setupSentryErrorHandler(app);

// Centralized error handler — guarantees every error response includes the
// requestId so users can quote it when reporting issues, and forwards the
// exception to Sentry with scrubbed context.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const eventId = captureException(err, {
    requestId: req.requestId,
    route: req.path,
    method: req.method,
    userId: req.currentUser?.id,
  });
  req.log?.error({ err, requestId: req.requestId, eventId }, "request.error");
  if (res.headersSent) return;
  const status = (err as Error & { status?: number }).status ?? 500;
  res.status(status).json({
    error: status >= 500 ? "Internal server error" : err.message,
    requestId: req.requestId,
    ...(eventId ? { eventId } : {}),
  });
});

export default app;
