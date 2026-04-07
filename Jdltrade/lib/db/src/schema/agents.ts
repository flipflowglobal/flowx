import { pgTable, uuid, text, real, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const agentStatusEnum = pgEnum("agent_status", ["running", "paused", "stopped", "error"]);
export const riskProfileEnum = pgEnum("risk_profile", ["Conservative", "Balanced", "Aggressive"]);
export const networkEnum = pgEnum("network", ["Ethereum", "Arbitrum", "Polygon", "Optimism", "Base"]);

export const agentsTable = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  strategy: text("strategy").notNull(),
  status: agentStatusEnum("status").notNull().default("running"),
  riskProfile: riskProfileEnum("risk_profile").notNull().default("Balanced"),
  network: networkEnum("network").notNull().default("Ethereum"),
  capital: real("capital").notNull().default(1000),
  pnl: real("pnl").notNull().default(0),
  pnlPct: real("pnl_pct").notNull().default(0),
  winRate: real("win_rate").notNull().default(0),
  totalTrades: integer("total_trades").notNull().default(0),
  activeTrades: integer("active_trades").notNull().default(0),
  compositeScore: real("composite_score"),
  ppoWeight: real("ppo_weight").notNull().default(0.25),
  thompsonWeight: real("thompson_weight").notNull().default(0.25),
  ukfWeight: real("ukf_weight").notNull().default(0.25),
  cmaEsWeight: real("cma_es_weight").notNull().default(0.25),
  autoRebalance: boolean("auto_rebalance").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastTradeAt: timestamp("last_trade_at"),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({
  id: true,
  pnl: true,
  pnlPct: true,
  winRate: true,
  totalTrades: true,
  activeTrades: true,
  compositeScore: true,
  createdAt: true,
  updatedAt: true,
  lastTradeAt: true,
});

export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
