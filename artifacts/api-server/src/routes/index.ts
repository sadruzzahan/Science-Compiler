import { Router, type IRouter } from "express";
import healthRouter from "./health";
import topicsRouter from "./topics";
import papersRouter from "./papers";
import claimsRouter from "./claims";
import studiesRouter from "./studies";
import evidenceLinksRouter from "./evidence_links";
import queryRouter from "./query";
import adminRouter from "./admin";
import usersRouter from "./users";
import { requireAdmin, requirePublicReadOrUser } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);

// Admin routes: gated solely by requireAdmin so anonymous/non-admin callers
// always get 403 FORBIDDEN regardless of PUBLIC_READ_ENABLED.
// adminRouter routes are already declared with the `/admin/...` prefix, so
// mount at root and gate with a path-scoped requireAdmin to ensure every
// /api/admin/* request — including unmatched paths — returns 403 for
// non-admins instead of leaking 404.
router.use("/admin", requireAdmin);
router.use(adminRouter);

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
