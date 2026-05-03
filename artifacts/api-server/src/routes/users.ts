import { Router, type IRouter } from "express";
import { requireUser } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/users/me", requireUser, async (req, res): Promise<void> => {
  const u = req.currentUser!;
  res.json({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    imageUrl: u.imageUrl,
    role: u.role,
    status: u.status,
    plan: "free",
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  });
});

export default router;
