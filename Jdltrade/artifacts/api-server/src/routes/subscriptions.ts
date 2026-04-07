import { Router, type IRouter, type Request, type Response } from "express";
import {
  createBillingRequest,
  createSubscriptionFromMandate,
  getSubscription,
  cancelSubscription,
  parseAndVerifyWebhook,
} from "../services/gocardless.js";
import {
  createGcSubscription,
  updateGcSubByBillingRequest,
  updateGcSubByMandateId,
  updateGcSubBySubscriptionId,
  getGcSubscriptionByClerkId,
  getGcSubByBillingRequest,
  activateUserSubscription,
  ensureGcSubscriptionColumns,
} from "../services/database.js";

// Ensure new columns exist on startup
ensureGcSubscriptionColumns().catch(console.error);

const router: IRouter = Router();

const MAIN_WALLET = process.env.SYSTEM_WALLET_ADDRESS || "0x8b74BCA1f75160A8bFD2907938B3662Dc62A6C03";

// ─── Plans ───────────────────────────────────────────────────────────────────

router.get("/subscriptions/plans", (_req, res) => {
  res.json({
    plans: [
      {
        id: "free",
        name: "Free",
        price: 0,
        currency: "AUD",
        interval: "month",
        features: ["1 AI Agent", "Basic analytics", "2 chains", "Community support"],
      },
      {
        id: "pro",
        name: "Pro",
        price: 49,
        currency: "AUD",
        interval: "month",
        features: ["5 AI Agents", "Full analytics", "All 6 chains", "Flash loans", "Priority support"],
      },
      {
        id: "elite",
        name: "Elite",
        price: 299,
        currency: "AUD",
        interval: "month",
        features: [
          "Unlimited agents",
          "Advanced analytics",
          "All chains + DEX",
          "Priority flash loans",
          "Dedicated support",
          "Custom strategies",
        ],
      },
    ],
    paymentMethod: "GoCardless direct debit (AUD)",
    cryptoPayment: {
      address: MAIN_WALLET,
      acceptedTokens: ["USDT", "USDC"],
      chains: ["Ethereum", "Polygon", "BSC", "Arbitrum"],
      instructions:
        "Send the equivalent AUD amount in USDT/USDC. Include your account email in the transaction memo.",
    },
  });
});

// ─── Checkout — creates billing request and returns authorisation URL ────────

router.post("/subscriptions/checkout", async (req, res) => {
  const { planId, email, name, isRecurring } = req.body as {
    planId: string;
    email?: string;
    name?: string;
    isRecurring?: boolean;
  };

  const clerkUserId: string | undefined = (req as any).auth?.userId;
  const recurring = isRecurring !== false; // default: recurring

  if (!planId || !["free", "pro", "elite"].includes(planId)) {
    res.status(400).json({ error: "Invalid plan. Use: free, pro, or elite" });
    return;
  }

  if (planId === "free") {
    if (clerkUserId) await activateUserSubscription(clerkUserId, "free");
    res.json({ message: "Free plan activated.", plan: "free" });
    return;
  }

  if (!process.env.GOCARDLESS_ACCESS_TOKEN) {
    res.status(503).json({ error: "Payment system not configured. Contact support@jdl.trading" });
    return;
  }

  if (!email || !name) {
    res.status(400).json({ error: "email and name are required for paid plans" });
    return;
  }

  try {
    const { billingRequestId, authorisationUrl } = await createBillingRequest(
      planId as "pro" | "elite",
      email,
      name,
      clerkUserId
    );

    const amountPence = planId === "pro" ? 4900 : 29900;
    await createGcSubscription({
      clerkUserId: clerkUserId || email,
      email,
      plan: planId,
      gcBillingRequestId: billingRequestId,
      amountPence,
      isRecurring: recurring,
    });

    res.json({
      plan: planId,
      billingRequestId,
      authorisationUrl,
      isRecurring: recurring,
      message: recurring
        ? "Redirect user to authorisationUrl to complete recurring direct debit setup"
        : "Redirect user to authorisationUrl to complete one-month direct debit payment",
    });
  } catch (err: any) {
    const detail = err?.response?.data || err?.response?.body || err?.message || String(err);
    console.error("[GoCardless] checkout error:", typeof detail === "object" ? JSON.stringify(detail) : detail);
    res.status(500).json({ error: "Failed to create billing request. Please try again.", detail: typeof detail === "string" ? detail : undefined });
  }
});

// ─── Complete — user returns here after authorising the mandate ──────────────

router.get("/subscriptions/complete", async (req, res) => {
  const { billing_request: billingRequestId, billing_request_flow: flowId } = req.query as Record<string, string>;

  if (!billingRequestId) {
    res.status(400).send("Missing billing_request parameter");
    return;
  }

  try {
    const sub = await getGcSubByBillingRequest(billingRequestId);
    if (!sub) {
      res.status(404).send("Subscription record not found");
      return;
    }

    await updateGcSubByBillingRequest(billingRequestId, { status: "mandate_pending" });

    const baseUrl = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS}`
      : "https://jdl.trading";

    res.redirect(`${baseUrl}/?subscription=pending&plan=${sub.plan}`);
  } catch (err: any) {
    console.error("[GoCardless] complete error:", err?.message);
    res.status(500).send("Error processing subscription completion");
  }
});

router.get("/subscriptions/cancelled", (_req, res) => {
  const baseUrl = process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS}`
    : "https://jdl.trading";
  res.redirect(`${baseUrl}/?subscription=cancelled`);
});

// ─── Activate — create subscription after mandate is active ─────────────────

router.post("/subscriptions/activate", async (req, res) => {
  const { mandateId, planId } = req.body as { mandateId: string; planId: string };

  if (!mandateId || !planId || !["pro", "elite"].includes(planId)) {
    res.status(400).json({ error: "mandateId and planId (pro|elite) are required" });
    return;
  }

  try {
    const subscription = await createSubscriptionFromMandate(mandateId, planId as "pro" | "elite");

    await updateGcSubByMandateId(mandateId, {
      gcSubscriptionId: subscription.id,
      status: "active",
      nextChargeDate: subscription.upcoming_payments?.[0]?.charge_date,
    });

    const clerkUserId: string | undefined = (req as any).auth?.userId;
    if (clerkUserId) await activateUserSubscription(clerkUserId, planId);

    res.json({
      subscriptionId: subscription.id,
      status: subscription.status,
      amount: subscription.amount,
      currency: subscription.currency,
      intervalUnit: subscription.interval_unit,
      upcomingPayments: subscription.upcoming_payments,
    });
  } catch (err: any) {
    console.error("[GoCardless] activate error:", err?.message);
    res.status(500).json({ error: "Failed to activate subscription" });
  }
});

// ─── Status ──────────────────────────────────────────────────────────────────

router.get("/subscriptions/status", async (req, res) => {
  const clerkUserId: string | undefined = (req as any).auth?.userId;
  const subscriptionId = req.query.subscriptionId as string | undefined;

  if (subscriptionId) {
    try {
      const sub = await getSubscription(subscriptionId);
      res.json({
        subscriptionId: sub.id,
        status: sub.status,
        plan: sub.name,
        amount: sub.amount,
        currency: sub.currency,
        intervalUnit: sub.interval_unit,
        upcomingPayments: sub.upcoming_payments,
      });
    } catch {
      res.status(404).json({ error: "Subscription not found" });
    }
    return;
  }

  if (clerkUserId) {
    const dbSub = await getGcSubscriptionByClerkId(clerkUserId);
    if (dbSub) {
      const isRecurring = dbSub.is_recurring !== false;
      const expiresAt: Date | null = dbSub.expires_at ? new Date(dbSub.expires_at) : null;
      const now = new Date();
      const msUntilExpiry = expiresAt ? expiresAt.getTime() - now.getTime() : null;
      const daysUntilExpiry = msUntilExpiry !== null ? Math.ceil(msUntilExpiry / 86400000) : null;
      const renewalWarning = !isRecurring && daysUntilExpiry !== null && daysUntilExpiry <= 7 && daysUntilExpiry > 0;
      const expired = !isRecurring && daysUntilExpiry !== null && daysUntilExpiry <= 0;

      res.json({
        plan: expired ? "free" : dbSub.plan,
        status: expired ? "expired" : dbSub.status,
        mandateId: dbSub.gc_mandate_id,
        subscriptionId: dbSub.gc_subscription_id,
        nextChargeDate: dbSub.next_charge_date,
        createdAt: dbSub.created_at,
        isRecurring,
        expiresAt: expiresAt?.toISOString() || null,
        daysUntilExpiry,
        renewalWarning,
        expired,
      });
      return;
    }
  }

  res.json({ plan: "free", status: "active", isRecurring: true, renewalWarning: false, expired: false });
});

// ─── Cancel ──────────────────────────────────────────────────────────────────

router.post("/subscriptions/cancel/:subscriptionId", async (req, res) => {
  const { subscriptionId } = req.params;
  try {
    const sub = await cancelSubscription(subscriptionId);
    await updateGcSubBySubscriptionId(subscriptionId, { status: "cancelled" });
    res.json({ message: "Subscription cancelled", subscriptionId: sub.id, status: sub.status });
  } catch (err: any) {
    console.error("[GoCardless] cancel error:", err?.message);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// ─── Webhook ─────────────────────────────────────────────────────────────────

router.post("/subscriptions/webhook/gocardless", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;
  const signature = req.headers["webhook-signature"] as string;
  const rawBody: Buffer = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

  let events: any[] = [];

  if (secret && signature) {
    const result = parseAndVerifyWebhook(rawBody, signature, secret);
    if (!result.valid) {
      console.warn("[GoCardless] Invalid webhook signature — rejected");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    events = result.events as any[];
  } else {
    events = req.body?.events || [];
  }

  for (const event of events) {
    const { resource_type, action, links, metadata } = event;
    console.log(`[GoCardless webhook] ${resource_type}.${action}`, JSON.stringify(links));

    try {
      if (resource_type === "billing_requests") {
        if (action === "fulfilled") {
          await updateGcSubByBillingRequest(links.billing_request, {
            gcMandateId: links.mandate,
            gcCustomerId: links.customer,
            status: "mandate_pending",
          });

          if (links.mandate && metadata?.plan) {
            // Look up whether this is a recurring or one-time subscription
            const { query: dbQuery } = await import("../services/database.js");
            const subRow = await dbQuery(
              `SELECT is_recurring FROM gc_subscriptions WHERE gc_billing_request_id = $1`,
              [links.billing_request]
            );
            const isRecurring = subRow.rows[0]?.is_recurring !== false;

            if (isRecurring) {
              const sub = await createSubscriptionFromMandate(
                links.mandate,
                metadata.plan as "pro" | "elite"
              );
              await updateGcSubByMandateId(links.mandate, {
                gcSubscriptionId: sub.id,
                status: "active",
                nextChargeDate: sub.upcoming_payments?.[0]?.charge_date,
              });
              console.log(`[GoCardless] Recurring subscription created: ${sub.id} for plan ${metadata.plan}`);
            } else {
              // One-time: set expires_at = 30 days from now, mark active
              const expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + 30);
              await dbQuery(
                `UPDATE gc_subscriptions SET status = 'active', expires_at = $2, updated_at = NOW() WHERE gc_mandate_id = $1`,
                [links.mandate, expiresAt]
              );
              console.log(`[GoCardless] One-time subscription activated for plan ${metadata.plan}, expires ${expiresAt.toISOString()}`);
            }

            if (metadata?.clerk_user_id) {
              await activateUserSubscription(metadata.clerk_user_id, metadata.plan);
            }
          }
        }
      }

      if (resource_type === "mandates") {
        if (action === "active") {
          await updateGcSubByMandateId(links.mandate, { status: "active" });
        } else if (action === "cancelled" || action === "expired" || action === "failed") {
          await updateGcSubByMandateId(links.mandate, { status: action });
        }
      }

      if (resource_type === "payments") {
        if (action === "paid_out") {
          console.log("[GoCardless] Payment paid out:", links.payment);
        } else if (action === "failed") {
          console.warn("[GoCardless] Payment failed:", links.payment);
          await updateGcSubBySubscriptionId(links.subscription || "", { status: "payment_failed" });
        }
      }

      if (resource_type === "subscriptions") {
        if (action === "created") {
          await updateGcSubBySubscriptionId(links.subscription, { status: "active" });
        } else if (action === "cancelled" || action === "finished") {
          await updateGcSubBySubscriptionId(links.subscription, { status: action });
        }
      }
    } catch (err: any) {
      console.error(`[GoCardless] Error processing ${resource_type}.${action}:`, err?.message);
    }
  }

  res.status(200).json({ received: true, processed: events.length });
});

// ─── Crypto payment info ─────────────────────────────────────────────────────

router.get("/subscriptions/crypto-payment", (_req, res) => {
  res.json({
    address: MAIN_WALLET,
    acceptedTokens: ["USDT", "USDC"],
    supportedChains: [
      { name: "Ethereum", chainId: 1 },
      { name: "Polygon", chainId: 137 },
      { name: "BSC", chainId: 56 },
      { name: "Arbitrum", chainId: 42161 },
    ],
    plans: {
      pro: { amountAud: 49, note: "Monthly Pro subscription" },
      elite: { amountAud: 299, note: "Monthly Elite subscription" },
    },
    instructions:
      "Send the exact AUD amount in USDT or USDC to the address above. Include your registered email in the transaction memo. Your subscription activates within 24h of payment confirmation.",
    support: "support@jdl.trading",
  });
});

export default router;
