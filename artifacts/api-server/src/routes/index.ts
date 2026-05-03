import { Router, type IRouter } from "express";
import healthRouter from "./health";
import topicsRouter from "./topics";
import papersRouter from "./papers";
import claimsRouter from "./claims";
import studiesRouter from "./studies";
import evidenceLinksRouter from "./evidence_links";
import queryRouter from "./query";
import adminRouter from "./admin";
import observabilityRouter from "./observability";
import usersRouter from "./users";
import usageRouter from "./usage";
import { requireAdmin, requirePublicReadOrUser } from "../middlewares/auth";
import { generalRateLimit, authRateLimit } from "../lib/rateLimits";

const router: IRouter = Router();

// Apply the per-IP / per-user general rate limit to ALL /api/* requests.
// Tighter per-route limits are applied inside the specific routers below.
router.use(generalRateLimit);

router.use(healthRouter);
// Auth-related endpoints use a slightly tighter limiter to discourage
// account-enumeration / session-spam style probes.
router.use(authRateLimit, usersRouter);
router.use(usageRouter);

// Admin routes: gated solely by requireAdmin so anonymous/non-admin callers
// always get 403 FORBIDDEN regardless of PUBLIC_READ_ENABLED.
// adminRouter routes are already declared with the `/admin/...` prefix, so
// mount at root and gate with a path-scoped requireAdmin to ensure every
// /api/admin/* request — including unmatched paths — returns 403 for
// non-admins instead of leaking 404.
router.use("/admin", requireAdmin);
router.use(adminRouter);
router.use(observabilityRouter);

// Authenticated-only routes (every handler in queryRouter already calls
// requireUser; mounting it here avoids accidental public-read leakage).
router.use(queryRouter);

// Public-read routes: gated per-router by PUBLIC_READ_ENABLED so the toggle
// only affects intended public surfaces. When "false", these require auth.
router.use(requirePublicReadOrUser, topicsRouter);
router.use(requirePublicReadOrUser, papersRouter);
router.use(requirePublicReadOrUser, claimsRouter);
router.use(requirePublicReadOrUser, studiesRouter);
router.use(requirePublicReadOrUser, evidenceLinksRouter);

export default router;
