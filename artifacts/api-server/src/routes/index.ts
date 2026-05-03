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
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(topicsRouter);
router.use(papersRouter);
router.use(claimsRouter);
router.use(studiesRouter);
router.use(evidenceLinksRouter);
router.use(queryRouter);
router.use("/admin", requireAdmin);
router.use(adminRouter);

export default router;
