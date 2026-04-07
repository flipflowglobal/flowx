import { Router, type IRouter } from "express";
import { ethers } from "ethers";
import {
  getOrComputeCreditScore,
  getEASSchema,
  crawlWallet,
  computeCreditScore,
  generateEASAttestation,
} from "../services/credit-oracle.js";

const router: IRouter = Router();

const queryLog: Array<{
  id: string;
  queryAddress: string;
  callerAddress: string;
  score: number;
  grade: string;
  fee: number;
  timestamp: number;
  chain: string;
}> = [];

router.get("/credit-oracle/schema", (_req, res) => {
  res.json(getEASSchema());
});

router.get("/credit-oracle/score/:address", async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: "Invalid Ethereum address" });
    return;
  }

  try {
    const score = await getOrComputeCreditScore(address);

    const logEntry = {
      id: `qry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      queryAddress: score.address,
      callerAddress: req.query.caller as string || "0x0000000000000000000000000000000000000000",
      score: score.score,
      grade: score.grade,
      fee: score.oracleFee,
      timestamp: Math.floor(Date.now() / 1000),
      chain: (req.query.chain as string) || "ethereum",
    };
    queryLog.push(logEntry);

    res.json({
      success: true,
      oracleFee: score.oracleFee,
      queryId: logEntry.id,
      creditScore: {
        address: score.address,
        score: score.score,
        grade: score.grade,
        maxBorrowUsd: score.maxBorrowUsd,
        riskLevel: score.riskLevel,
        confidence: score.confidence,
        timestamp: score.timestamp,
        expiresAt: score.expiresAt,
      },
      breakdown: score.breakdown,
      attestation: score.attestation,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/credit-oracle/full/:address", async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: "Invalid Ethereum address" });
    return;
  }

  try {
    const score = await getOrComputeCreditScore(address);
    res.json({
      success: true,
      creditScore: score,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/credit-oracle/query", async (req, res) => {
  const { borrowerAddress, lenderAddress, requestedAmount, chain } = req.body as {
    borrowerAddress: string;
    lenderAddress?: string;
    requestedAmount?: number;
    chain?: string;
  };

  if (!borrowerAddress || !ethers.isAddress(borrowerAddress)) {
    res.status(400).json({ error: "Valid borrowerAddress is required" });
    return;
  }

  try {
    const score = await getOrComputeCreditScore(borrowerAddress);

    const approved = requestedAmount
      ? requestedAmount <= score.maxBorrowUsd && score.score >= 500
      : score.score >= 500;

    const interestRate = computeInterestRate(score.score);

    const logEntry = {
      id: `qry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      queryAddress: score.address,
      callerAddress: lenderAddress || "0x0000000000000000000000000000000000000000",
      score: score.score,
      grade: score.grade,
      fee: score.oracleFee,
      timestamp: Math.floor(Date.now() / 1000),
      chain: chain || "ethereum",
    };
    queryLog.push(logEntry);

    res.json({
      success: true,
      oracleResponse: {
        queryId: logEntry.id,
        borrower: score.address,
        approved,
        creditScore: score.score,
        grade: score.grade,
        maxBorrowUsd: score.maxBorrowUsd,
        requestedAmount: requestedAmount || null,
        withinLimit: requestedAmount ? requestedAmount <= score.maxBorrowUsd : null,
        suggestedInterestRate: interestRate,
        riskLevel: score.riskLevel,
        confidence: score.confidence,
        attestationUid: score.attestation?.uid || null,
        expiresAt: score.expiresAt,
        oracleFee: score.oracleFee,
      },
      loanTerms: approved ? {
        maxDuration: score.score >= 700 ? 365 : score.score >= 600 ? 180 : 90,
        collateralRequired: score.score >= 700 ? 0 : score.score >= 600 ? 0.1 : 0.25,
        interestRate,
        liquidationThreshold: score.score >= 700 ? 0 : 0.85,
      } : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/credit-oracle/attestation/:address", async (req, res) => {
  const { address } = req.params;
  const chain = (req.query.chain as string) || "ethereum";

  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: "Invalid Ethereum address" });
    return;
  }

  try {
    const score = await getOrComputeCreditScore(address);
    const attestation = generateEASAttestation(score, chain);

    res.json({
      success: true,
      attestation,
      verificationData: {
        schemaId: attestation.schemaId,
        easContract: attestation.chain === "ethereum"
          ? "0xA1207F3BBa224E2c9c3c6D5aF63D816e64D54A33"
          : "See EAS docs for chain-specific addresses",
        decodedFields: {
          creditScore: score.score,
          grade: score.grade,
          maxBorrowUsd: score.maxBorrowUsd,
          timestamp: score.timestamp,
          expiresAt: score.expiresAt,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/credit-oracle/queries", (_req, res) => {
  const recentQueries = queryLog.slice(-50).reverse();
  const totalFees = queryLog.reduce((sum, q) => sum + q.fee, 0);
  res.json({
    queries: recentQueries,
    stats: {
      totalQueries: queryLog.length,
      totalFeesEarned: Math.round(totalFees * 10000) / 10000,
      uniqueAddresses: new Set(queryLog.map((q) => q.queryAddress)).size,
      avgScore: queryLog.length > 0
        ? Math.round(queryLog.reduce((s, q) => s + q.score, 0) / queryLog.length)
        : 0,
    },
  });
});

router.post("/credit-oracle/batch", async (req, res) => {
  const { addresses } = req.body as { addresses: string[] };
  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
    res.status(400).json({ error: "Array of addresses required" });
    return;
  }
  if (addresses.length > 10) {
    res.status(400).json({ error: "Maximum 10 addresses per batch" });
    return;
  }

  const results = await Promise.all(
    addresses.map(async (addr) => {
      if (!ethers.isAddress(addr)) {
        return { address: addr, error: "Invalid address" };
      }
      try {
        const score = await getOrComputeCreditScore(addr);
        return {
          address: score.address,
          score: score.score,
          grade: score.grade,
          maxBorrowUsd: score.maxBorrowUsd,
          riskLevel: score.riskLevel,
          confidence: score.confidence,
        };
      } catch (err: any) {
        return { address: addr, error: err.message };
      }
    })
  );

  res.json({
    success: true,
    results,
    totalFee: results.filter((r) => !("error" in r)).length * 0.001,
  });
});

function computeInterestRate(score: number): number {
  if (score >= 800) return 2.5;
  if (score >= 750) return 3.5;
  if (score >= 700) return 5.0;
  if (score >= 650) return 7.5;
  if (score >= 600) return 10.0;
  if (score >= 550) return 14.0;
  if (score >= 500) return 18.0;
  return 25.0;
}

export default router;
