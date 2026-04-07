import { Router, type IRouter } from "express";
import { getUncachableStripeClient } from "../stripeClient.js";
import { query } from "../services/database.js";
import { requireAuth } from "../app.js";

const router: IRouter = Router();

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function ensureStripeColumns() {
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT
  `);
}

ensureStripeColumns().catch(() => {});

async function getUserStripeInfo(clerkUserId: string) {
  const res = await query(
    `SELECT stripe_customer_id, stripe_subscription_id, email, name FROM users WHERE clerk_user_id = $1`,
    [clerkUserId]
  );
  return res.rows[0] || null;
}

async function updateUserStripeInfo(clerkUserId: string, data: {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}) {
  const updates: string[] = [];
  const values: any[] = [clerkUserId];
  if (data.stripeCustomerId !== undefined) {
    values.push(data.stripeCustomerId);
    updates.push(`stripe_customer_id = $${values.length}`);
  }
  if (data.stripeSubscriptionId !== undefined) {
    values.push(data.stripeSubscriptionId);
    updates.push(`stripe_subscription_id = $${values.length}`);
  }
  if (updates.length === 0) return;
  await query(`UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE clerk_user_id = $1`, values);
}

// ─── Stripe Products / Plans ──────────────────────────────────────────────────

router.get("/stripe/plans", async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.description AS product_description,
        p.metadata AS product_metadata,
        pr.id AS price_id,
        pr.unit_amount,
        pr.currency,
        pr.recurring
      FROM stripe.products p
      JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
      WHERE p.active = true
      ORDER BY pr.unit_amount ASC
    `);

    const plans: Record<string, any> = {};
    for (const row of result.rows) {
      const pid = row.product_id;
      if (!plans[pid]) {
        plans[pid] = {
          productId: pid,
          name: row.product_name,
          description: row.product_description,
          tier: row.product_metadata?.tier || null,
          prices: [],
        };
      }
      plans[pid].prices.push({
        priceId: row.price_id,
        unitAmount: row.unit_amount,
        currency: row.currency,
        recurring: row.recurring,
        displayAmount: `A$${((row.unit_amount || 0) / 100).toFixed(0)}`,
      });
    }

    res.json({ plans: Object.values(plans) });
  } catch (err: any) {
    console.error("[Stripe] Failed to list plans:", err.message);
    res.status(500).json({ error: "Failed to load subscription plans" });
  }
});

// ─── Create Checkout Session ──────────────────────────────────────────────────

router.post("/stripe/checkout", requireAuth, async (req: any, res) => {
  const clerkUserId = req.userId as string;
  const { priceId, planId } = req.body as { priceId: string; planId?: string };

  if (!priceId) {
    res.status(400).json({ error: "priceId is required" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const userInfo = await getUserStripeInfo(clerkUserId);

    let customerId = userInfo?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userInfo?.email || undefined,
        name: userInfo?.name || undefined,
        metadata: { clerkUserId, platform: "jdl-trading" },
      });
      customerId = customer.id;
      await updateUserStripeInfo(clerkUserId, { stripeCustomerId: customerId });
    }

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    const baseUrl = domain ? `https://${domain}` : "https://jdl.trading";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${baseUrl}/?stripe=success&plan=${planId || "pro"}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?stripe=cancelled`,
      metadata: { clerkUserId, planId: planId || "pro" },
      subscription_data: {
        metadata: { clerkUserId, planId: planId || "pro" },
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error("[Stripe] Checkout error:", err.message);
    res.status(500).json({ error: "Failed to create Stripe checkout session" });
  }
});

// ─── Customer Portal ──────────────────────────────────────────────────────────

router.post("/stripe/portal", requireAuth, async (req: any, res) => {
  const clerkUserId = req.userId as string;

  try {
    const stripe = await getUncachableStripeClient();
    const userInfo = await getUserStripeInfo(clerkUserId);

    if (!userInfo?.stripe_customer_id) {
      res.status(404).json({ error: "No Stripe subscription found. Please subscribe first." });
      return;
    }

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    const baseUrl = domain ? `https://${domain}` : "https://jdl.trading";

    const session = await stripe.billingPortal.sessions.create({
      customer: userInfo.stripe_customer_id,
      return_url: `${baseUrl}/`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    console.error("[Stripe] Portal error:", err.message);
    res.status(500).json({ error: "Failed to open billing portal" });
  }
});

// ─── Stripe Subscription Status ───────────────────────────────────────────────

router.get("/stripe/subscription", requireAuth, async (req: any, res) => {
  const clerkUserId = req.userId as string;

  try {
    const userInfo = await getUserStripeInfo(clerkUserId);

    if (!userInfo?.stripe_subscription_id) {
      res.json({ subscription: null, plan: "free" });
      return;
    }

    const result = await query(
      `SELECT * FROM stripe.subscriptions WHERE id = $1`,
      [userInfo.stripe_subscription_id]
    );

    const sub = result.rows[0];
    if (!sub) {
      res.json({ subscription: null, plan: "free" });
      return;
    }

    const priceResult = await query(
      `SELECT pr.unit_amount, pr.currency, p.metadata as product_metadata
       FROM stripe.prices pr
       JOIN stripe.products p ON p.id = pr.product
       WHERE pr.id = $1`,
      [sub.items?.data?.[0]?.price?.id || ""]
    );

    const priceRow = priceResult.rows[0];
    const tier = priceRow?.product_metadata?.tier || "pro";

    res.json({
      subscription: {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
      plan: sub.status === "active" ? tier : "free",
    });
  } catch (err: any) {
    console.error("[Stripe] Subscription status error:", err.message);
    res.status(500).json({ error: "Failed to retrieve subscription status" });
  }
});

export default router;
