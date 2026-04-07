import GoCardless from "gocardless-nodejs";
import { Environments } from "gocardless-nodejs/constants";
import { parse as parseWebhook, InvalidSignatureError } from "gocardless-nodejs/webhooks";

const CREDITOR_ID = process.env.GOCARDLESS_CREDITOR_ID || "CR00013PBFJ6HS";

function getClient() {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!token) throw new Error("GOCARDLESS_ACCESS_TOKEN not set");
  const env = token.startsWith("live_") ? Environments.Live : Environments.Sandbox;
  return GoCardless(token, env, { raiseOnIdempotencyConflict: true });
}

export const PLANS = {
  free:  { name: "JDL Free",  amountPence: 0,     intervalUnit: "monthly" as const },
  pro:   { name: "JDL Pro",   amountPence: 4900,  intervalUnit: "monthly" as const },
  elite: { name: "JDL Elite", amountPence: 29900, intervalUnit: "monthly" as const },
};

export async function createBillingRequest(
  planId: "pro" | "elite",
  email: string,
  name: string,
  clerkUserId?: string
) {
  const gc = getClient();
  const plan = PLANS[planId];

  const baseUrl = process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS}`
    : "https://jdl.trading";

  // Split name safely — GoCardless requires non-empty strings
  const parts = name.trim().split(/\s+/);
  const givenName  = parts[0] || "JDL";
  const familyName = parts.length > 1 ? parts.slice(1).join(" ") : parts[0] || "User";

  // Billing request: mandate only (recurring direct debit authorisation).
  // NOTE: prefilled_customer is NOT valid on billingRequests.create() —
  // it belongs only on billingRequestFlows.create().
  const br = await gc.billingRequests.create({
    mandate_request: {
      currency: "AUD",
      description: `JDL Trading Platform — ${plan.name}`,
    },
    metadata: {
      plan: planId,
      clerk_user_id: clerkUserId || "",
    },
  });

  const flow = await gc.billingRequestFlows.create({
    redirect_uri: `${baseUrl}/api/subscriptions/complete`,
    exit_uri:     `${baseUrl}/api/subscriptions/cancelled`,
    links:        { billing_request: br.id! },
    prefilled_customer: {
      email,
      given_name: givenName,
      family_name: familyName,
    },
  });

  return {
    billingRequestId: br.id!,
    authorisationUrl: flow.authorisation_url!,
  };
}

export async function createSubscriptionFromMandate(mandateId: string, planId: "pro" | "elite") {
  const gc = getClient();
  const plan = PLANS[planId];

  const sub = await gc.subscriptions.create({
    amount: plan.amountPence as any,
    currency: "AUD",
    name: plan.name,
    interval_unit: plan.intervalUnit as any,
    links: { mandate: mandateId },
    metadata: { plan: planId },
  });

  return sub;
}

export async function getSubscription(subscriptionId: string) {
  const gc = getClient();
  return gc.subscriptions.find(subscriptionId);
}

export async function cancelSubscription(subscriptionId: string) {
  const gc = getClient();
  return gc.subscriptions.cancel(subscriptionId, {});
}

export async function getMandate(mandateId: string) {
  const gc = getClient();
  return gc.mandates.find(mandateId);
}

export async function listCustomerSubscriptions(customerId: string) {
  const gc = getClient();
  return gc.subscriptions.list({ customer: customerId });
}

export function parseAndVerifyWebhook(rawBody: Buffer, signature: string, secret: string) {
  try {
    const events = parseWebhook(rawBody, secret, signature);
    return { valid: true, events };
  } catch (err: any) {
    if (err?.name === "InvalidSignatureError" || err instanceof InvalidSignatureError) {
      return { valid: false, events: [] };
    }
    throw err;
  }
}
