import app from "./app";
import { logger } from "./lib/logger";
import { initSystemWallet } from "./services/blockchain";
import { startPriceFeed } from "./services/price-feed";
import { startAgentExecutor } from "./services/agent-executor";
import { initContractCompiler } from "./services/contract-compiler";
import { startHealthMonitor } from "./services/health-monitor";
import { startAllModules } from "./modules/index";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";

// ── Global process error guards ──────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  logger.error({ err }, "[FATAL] Uncaught exception — process will continue");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[WARN] Unhandled promise rejection");
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM — graceful shutdown");
  process.exit(0);
});

// ── Boot ─────────────────────────────────────────────────────────────────────
const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const systemWallet = initSystemWallet();
logger.info({ address: systemWallet.address, isNew: systemWallet.isNew }, "System wallet initialized");
if (systemWallet.isNew) {
  logger.warn("NEW system wallet generated — save SYSTEM_WALLET_PRIVATE_KEY to persist across restarts");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start background services
  startPriceFeed();
  startAgentExecutor();
  startHealthMonitor();
  initContractCompiler().catch((e) => logger.warn({ err: e }, "Contract compiler init warning"));

  // Start intelligence module system (12 modules)
  startAllModules().catch((e) => logger.warn({ err: e }, "Module system init warning"));

  // Initialize Stripe schema + webhooks (non-blocking — server already listening)
  (async () => {
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) { logger.warn("[Stripe] DATABASE_URL missing — skipping Stripe init"); return; }

      // Step 1: create stripe schema tables (idempotent)
      const { getStripeSecretKey } = await import("./stripeClient.js");
      const secretKey = await getStripeSecretKey();
      await runMigrations({ databaseUrl, schema: "stripe", stripeSecretKey: secretKey } as any);
      logger.info("[Stripe] Schema ready");

      // Step 2: get StripeSync AFTER migrations (tables must exist)
      const stripeSync = await getStripeSync();

      // Step 3: set up managed webhook
      const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
      if (domain) {
        try {
          await stripeSync.findOrCreateManagedWebhook(`https://${domain}/api/stripe/webhook`);
          logger.info("[Stripe] Managed webhook configured");
        } catch (webhookErr: any) {
          logger.warn({ err: webhookErr?.message }, "[Stripe] Webhook setup skipped (non-fatal)");
        }
      }

      // Step 4: backfill existing Stripe data asynchronously
      stripeSync.syncBackfill()
        .then(() => logger.info("[Stripe] Backfill complete"))
        .catch((e: any) => logger.warn({ err: e?.message }, "[Stripe] Backfill error (non-fatal)"));
    } catch (e: any) {
      logger.warn({ err: e?.message }, "[Stripe] Init error (non-fatal — will retry on next restart)");
    }
  })();
});
