import { Router, type IRouter, raw } from "express";
import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { adminEmails } from "../middlewares/auth";

const router: IRouter = Router();

interface ClerkUserEmail {
  id: string;
  email_address: string;
}
interface ClerkUserData {
  id: string;
  email_addresses?: ClerkUserEmail[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  last_sign_in_at?: number | null;
  // Session events carry the Clerk user id under `user_id`, not `id`
  // (which is the session id).
  user_id?: string;
}

function primaryEmail(data: ClerkUserData): string {
  const list = data.email_addresses ?? [];
  const primary = data.primary_email_address_id
    ? list.find((e) => e.id === data.primary_email_address_id)
    : list[0];
  return primary?.email_address ?? `${data.id}@unknown.local`;
}

router.post(
  "/webhooks/clerk",
  raw({ type: "application/json" }),
  async (req, res): Promise<void> => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      logger.warn("CLERK_WEBHOOK_SECRET not set — rejecting webhook");
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }
    const svixId = req.headers["svix-id"] as string | undefined;
    const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
    const svixSignature = req.headers["svix-signature"] as string | undefined;
    if (!svixId || !svixTimestamp || !svixSignature) {
      res.status(400).json({ error: "Missing svix headers" });
      return;
    }
    const wh = new Webhook(secret);
    let evt: { type: string; data: ClerkUserData };
    try {
      const body = req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body);
      evt = wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as { type: string; data: ClerkUserData };
    } catch (err) {
      logger.warn({ err }, "Clerk webhook signature verification failed");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const data = evt.data;
    // For user.* events, data.id is the Clerk user id. For session.* events,
    // data.id is the session id and the user id is at data.user_id.
    const isSessionEvent = evt.type.startsWith("session.");
    const clerkUserId = isSessionEvent ? data.user_id : data.id;
    if (!clerkUserId) {
      res.status(400).json({ error: "Missing user id" });
      return;
    }

    try {
      if (evt.type === "user.created" || evt.type === "user.updated") {
        const email = primaryEmail(data);
        const role = adminEmails().includes(email.toLowerCase()) ? "admin" : "user";
        const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId)).limit(1);
        if (existing) {
          const willPromote = role === "admin" && existing.role !== "admin";
          await db
            .update(usersTable)
            .set({
              email,
              firstName: data.first_name ?? existing.firstName,
              lastName: data.last_name ?? existing.lastName,
              imageUrl: data.image_url ?? existing.imageUrl,
              // Promote to admin if email matches list, but never auto-demote.
              role: role === "admin" ? "admin" : existing.role,
              lastSignInAt: data.last_sign_in_at ? new Date(data.last_sign_in_at) : existing.lastSignInAt,
            })
            .where(eq(usersTable.id, existing.id));
          if (willPromote) {
            logger.info(
              { userId: existing.id, clerkUserId, email, source: "clerk_webhook" },
              "User promoted to admin via Clerk webhook + ADMIN_EMAILS allowlist",
            );
          }
        } else {
          const [created] = await db
            .insert(usersTable)
            .values({
              clerkId: clerkUserId,
              email,
              firstName: data.first_name ?? null,
              lastName: data.last_name ?? null,
              imageUrl: data.image_url ?? null,
              role,
              status: "active",
              lastSignInAt: data.last_sign_in_at ? new Date(data.last_sign_in_at) : null,
            })
            .returning();
          if (created && role === "admin") {
            logger.info(
              { userId: created.id, clerkUserId, email, source: "clerk_webhook" },
              "User created as admin via Clerk webhook + ADMIN_EMAILS allowlist",
            );
          }
        }
      } else if (evt.type === "user.deleted") {
        await db.delete(usersTable).where(eq(usersTable.clerkId, clerkUserId));
      } else if (evt.type === "session.created") {
        await db
          .update(usersTable)
          .set({ lastSignInAt: new Date() })
          .where(eq(usersTable.clerkId, clerkUserId));
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, type: evt.type }, "Failed to process Clerk webhook");
      res.status(500).json({ error: "Webhook processing failed" });
    }
  },
);

export default router;
