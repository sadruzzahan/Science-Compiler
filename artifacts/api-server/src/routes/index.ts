import { Router, type IRouter } from "express";
import healthRouter from "./health";
import topicsRouter from "./topics";
import papersRouter from "./papers";
import claimsRouter from "./claims";
import studiesRouter from "./studies";
import queryRouter from "./query";

const router: IRouter = Router();

router.use(healthRouter);
router.use(topicsRouter);
router.use(papersRouter);
router.use(claimsRouter);
router.use(studiesRouter);
router.use(queryRouter);

export default router;
