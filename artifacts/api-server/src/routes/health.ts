import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getReadiness } from "../lib/readiness";

const router: IRouter = Router();

// Legacy /healthz kept for backwards compatibility (callers may still hit it).
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health/live", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

router.get("/health/ready", async (_req, res): Promise<void> => {
  const snap = await getReadiness();
  res.status(snap.ready ? 200 : 503).json({
    status: snap.ready ? "ok" : "degraded",
    checks: snap.checks,
    checkedAt: new Date(snap.checkedAt).toISOString(),
  });
});

router.get("/health/version", (_req, res) => {
  res.json({
    sha: process.env.BUILD_SHA ?? "dev",
    builtAt: process.env.BUILD_TIME ?? null,
    nodeVersion: process.version,
    env: process.env.NODE_ENV ?? "development",
  });
});

export default router;
