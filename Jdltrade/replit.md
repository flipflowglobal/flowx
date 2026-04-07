# JDL Autonomous Trading Platform

## Overview
JDL is a sovereign-grade decentralized trading platform. It integrates flash loan arbitrage with a multi-agent AI intelligence system to offer a full-stack DeFi trading SaaS. Key capabilities include an Expo mobile app, an Express TypeScript API backend with real blockchain connectivity across six chains, Clerk authentication, and a PostgreSQL database. The platform leverages advanced trading algorithms and aims to provide an autonomous trading experience with features like health scoring for agents and real on-chain execution.

## User Preferences
- **Name**: Darcel King
- **Email**: darcel@jdl.trading
- **Support**: support@jdl.trading
- **Subscription**: Pro
- **KYC**: Verified
- **Referral Code**: JDL-PRO-7X2K

## System Architecture

### UI/UX
The mobile frontend is built with Expo and React Native, featuring an iOS-level dark UI theme. It includes eight main tabs: Dashboard, Agents, Flash Loans, Credit, Keys, Activity, Wallets, and Settings. Authentication screens are JDL-branded, integrated via Clerk.

### Technical Implementation
- **Frontend**: Expo, React Native, TypeScript, Expo Router. Clerk is used for authentication, and API calls are authenticated using Clerk tokens.
- **Backend**: Express 5, TypeScript, ethers.js v6. Authentication is managed by `@clerk/express` middleware. Security measures include Helmet, express-rate-limit, express-session, and CORS.
- **Trading Engine**: Incorporates ten strategies (e.g., Triangular Arb, Flash Loan Arb, Momentum, Mean Reversion) and advanced algorithms such as Monte Carlo simulations, Black-Scholes, Bellman DP, MDP for multi-chain routing, PPO Agent, and Thompson Sampling. A composite signal combines 11 weighted indicators for trade decisions. Real win rate tracking and price history management are integral.
- **Health Scoring System**: Agents are evaluated based on a formula combining win-rate, profit factor, drawdown, and AI score. Thresholds trigger different monitoring levels, and a hallucination detection mechanism identifies underperforming agents.
- **Flash Loan Contract Compiler**: Utilizes `src/contracts/JDLFlashReceiver.sol` for multi-hop arbitrage. A service compiles Solidity contracts at runtime with `solc`, with a fallback to pre-compiled bytecode.
- **Blockchain Service**: Supports Ethereum, Polygon, Arbitrum, BSC, Avalanche, and Optimism. It manages system and agent wallets, applies system fees (0.75% system transfer, 2% deposit), and handles trade execution.
- **Database**: PostgreSQL is used for persistence. All private keys are encrypted with AES-256-GCM. Key tables include `users`, `wallet_vault`, `agents`, `agent_wallets`, `trades`, and `system_config`.
- **API Endpoints**: Comprehensive API for user management, agent and strategy control, wallet and blockchain interactions, and platform-wide data.
- **On-Chain Execution**:
    - **Agent Trades**: Real Uniswap V3 DEX swaps on supported chains, with PancakeSwap V3 for BSC. Trades execute if signal confidence is ≥80%, otherwise they fall back to paper trades.
    - **Flash Loans**: Real Aave V3 executions using the `JDLFlashReceiver` contract. The system deploys and reuses receiver contracts per chain.
- **Production Readiness**: Features like wallet creation (`ethers.Wallet.createRandom()`), real flash loan executions via Aave V3, and real Uniswap V3 swaps demonstrate production readiness, with fallbacks to paper trades if wallets are unfunded.

### Design Choices
- **Multi-chain Support**: Native integration with six major blockchain networks.
- **Decentralized Approach**: Leveraging flash loans and DEX swaps for core trading functionalities.
- **AI-driven Automation**: Core reliance on the Aureon multi-agent AI for intelligent trading decisions.
- **Security**: Robust authentication via Clerk, encrypted private keys, and API security measures.
- **User Experience**: Intuitive mobile interface with dark theme and comprehensive dashboard.

## External Dependencies
- **Clerk**: For user authentication and authorization (ClerkProvider, `@clerk/expo`, `@clerk/express`).
- **PostgreSQL**: Primary database for all platform data.
- **GoCardless**: For processing recurring subscription payments and managing billing webhooks.
- **CoinGecko**: Live price feed for cryptocurrency market data.
- **Uniswap V3**: For real DEX swaps on Ethereum, Arbitrum, Polygon, Optimism, and Avalanche.
- **PancakeSwap V3**: For real DEX swaps on Binance Smart Chain (BSC).
- **Aave V3**: For real flash loan executions on supported chains.
- **solc**: Solidity compiler for dynamic contract compilation.
- **ethers.js v6**: JavaScript library for interacting with the Ethereum blockchain.