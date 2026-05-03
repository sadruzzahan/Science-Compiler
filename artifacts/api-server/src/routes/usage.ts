import { Router, type IRouter } from "express";
import { requireUser, requireAdmin } from "../middlewares/auth";
import {
  buildUsageMe,
  buildAdminUsage,
  planForUser,
  adminResetBudgetForToday,
  getBudgetStatus,
} from "../lib/usage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/usage/me", requireUser, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const plan = planForUser(user);
  const payload = await buildUsageMe(user.id, plan);
  res.json(payload);
});

router.get("/admin/usage", requireAdmin, async (_req, res): Promise<void> => {
  const summary = await buildAdminUsage();
  res.json(summary);
});

router.post("/admin/usage/reset-budget", requireAdmin, async (req, res): Promise<void> => {
  adminResetBudgetForToday();
  logger.info(
    { userId: req.currentUser?.id, email: req.currentUser?.email },
    "Admin reset LLM daily budget cap (audit)",
  );
  const status = await getBudgetStatus();
  res.json({ ok: true, budget: status });
});

export default router;
