import { pgTable, uuid, text, real, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const walletTypeEnum = pgEnum("wallet_type", ["generated", "connected", "imported"]);
export const walletNetworkEnum = pgEnum("wallet_network", ["Ethereum", "Arbitrum", "Polygon", "Optimism", "Base"]);

export const walletsTable = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address").notNull().unique(),
  type: walletTypeEnum("type").notNull().default("generated"),
  network: walletNetworkEnum("network").notNull().default("Ethereum"),
  encryptedPrivateKey: text("encrypted_private_key"),
  encryptedMnemonic: text("encrypted_mnemonic"),
  hdDerivationPath: text("hd_derivation_path"),
  ethBalance: real("eth_balance").notNull().default(0),
  usdcBalance: real("usdc_balance").notNull().default(0),
  totalUsd: real("total_usd").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  lastSync: timestamp("last_sync"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWalletSchema = createInsertSchema(walletsTable).omit({
  id: true,
  encryptedPrivateKey: true,
  encryptedMnemonic: true,
  ethBalance: true,
  usdcBalance: true,
  totalUsd: true,
  lastSync: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof walletsTable.$inferSelect;
