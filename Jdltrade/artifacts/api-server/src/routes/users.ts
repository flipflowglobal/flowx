import { Router } from "express";
import { getAuth } from "@clerk/express";
import { requireAuth } from "../app.js";
import { upsertUser, getUserByClerkId, updateSubscription, getUserAgents, getUserTrades, getUserPreferences, saveUserPreferences } from "../services/database.js";

const router = Router();

router.post("/sync", requireAuth, async (req: any, res) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth.userId!;
    const { email, name } = req.body as { email: string; name?: string };

    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const user = await upsertUser(clerkUserId, email, name);
    res.json({ success: true, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me", requireAuth, async (req: any, res) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth.userId!;

    let user = await getUserByClerkId(clerkUserId);
    if (!user) {
      const { email, name } = req.body as { email?: string; name?: string };
      if (email) {
        user = await upsertUser(clerkUserId, email, name);
      } else {
        res.status(404).json({ error: "User not found. Please sync first." });
        return;
      }
    }

    res.json({ user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me/agents", requireAuth, async (req: any, res) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth.userId!;
    const agents = await getUserAgents(clerkUserId);
    res.json({ agents, total: agents.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me/trades", requireAuth, async (req: any, res) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth.userId!;
    const limit = parseInt(req.query.limit as string) || 50;
    const trades = await getUserTrades(clerkUserId, limit);
    res.json({ trades, total: trades.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/me/subscription", requireAuth, async (req: any, res) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth.userId!;
    const { tier, expiresAt } = req.body as { tier: string; expiresAt?: string };

    const validTiers = ["free", "pro", "elite"];
    if (!validTiers.includes(tier)) {
      res.status(400).json({ error: "Invalid tier" });
      return;
    }

    await updateSubscription(clerkUserId, tier, expiresAt ? new Date(expiresAt) : undefined);
    res.json({ success: true, tier });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me/preferences", async (req: any, res) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      res.json({ preferences: {} });
      return;
    }
    const preferences = await getUserPreferences(clerkUserId);
    res.json({ preferences });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/me/preferences", async (req: any, res) => {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      res.json({ preferences: {} });
      return;
    }
    const updates = req.body as Record<string, any>;
    const preferences = await saveUserPreferences(clerkUserId, updates);
    res.json({ preferences });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
