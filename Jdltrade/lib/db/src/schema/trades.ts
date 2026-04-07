import { pgTable, uuid, text, real, integer, boolean, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { agentsTable } from "./agents";

export const tradeTypeEnum = pgEnum("trade_type", ["BUY", "SELL", "FLASH_LOAN", "SWAP"]);
export const tradeStatusEnum = pgEnum("trade_status", ["pending", "success", "failed", "cancelled"]);

export const tradesTable = pgTable("trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  type: tradeTypeEnum("type").notNull(),
  status: tradeStatusEnum("status").notNull().default("pending"),
  pair: text("pair").notNull(),
  inputToken: text("input_token").notNull(),
  outputToken: text("output_token").notNull(),
  inputAmount: real("input_amount"),
  outputAmount: real("output_amount"),
  profit: real("profit"),
  gasUsed: integer("gas_used"),
  gasCostUsd: real("gas_cost_usd"),
  txHash: text("tx_hash"),
  blockNumber: integer("block_number"),
  network: text("network").notNull().default("Ethereum"),
  dex: text("dex"),
  flashLoanAmount: real("flash_loan_amount"),
  flashLoanRoute: jsonb("flash_loan_route"),
  confidence: real("confidence"),
  revertReason: text("revert_reason"),
  executedAt: timestamp("executed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
