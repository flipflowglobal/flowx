/**
 * JDL Contract Compiler Engine
 * Compiles Solidity contracts at runtime using solc, caches versioned outputs.
 * Falls back to the pre-compiled TypeScript constants if solc is unavailable.
 *
 * Endpoints exposed via flash-loans route:
 *   GET  /api/flash-loans/compiler/status   — current compiled version info
 *   POST /api/flash-loans/compiler/rebuild  — trigger a hot recompile
 */

import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { RECEIVER_ABI, RECEIVER_BYTECODE } from "../contracts/JDLFlashReceiver.js";

const _require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompiledContract {
  abi:           any[];
  bytecode:      string;
  version:       string;
  contractName:  string;
  compiledAt:    string;
  solcVersion:   string;
  source:        "runtime" | "static";
}

interface CompilerState {
  latest:     CompiledContract | null;
  history:    CompiledContract[];
  lastAttempt: string | null;
  lastError:   string | null;
  isCompiling: boolean;
}

// ─── State ────────────────────────────────────────────────────────────────────

const state: CompilerState = {
  latest:      null,
  history:     [],
  lastAttempt: null,
  lastError:   null,
  isCompiling: false,
};

// ─── Static fallback (pre-compiled TypeScript constants) ──────────────────────

function staticFallback(): CompiledContract {
  return {
    abi:          RECEIVER_ABI as unknown as any[],
    bytecode:     RECEIVER_BYTECODE,
    version:      "2.0.0-static",
    contractName: "JDLFlashReceiver",
    compiledAt:   new Date().toISOString(),
    solcVersion:  "0.8.10 (static)",
    source:       "static",
  };
}

// ─── Runtime compiler ─────────────────────────────────────────────────────────

async function compileWithSolc(): Promise<CompiledContract> {
  // Load solc (CommonJS module)
  const solc = _require("solc");

  // Locate the .sol file — process.cwd() = artifacts/api-server (build root)
  const solPath = join(process.cwd(), "src/contracts/JDLFlashReceiver.sol");
  if (!existsSync(solPath)) throw new Error(`Contract source not found: ${solPath}`);

  const source = readFileSync(solPath, "utf-8");

  const input = {
    language: "Solidity",
    sources: {
      "JDLFlashReceiver.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode"] },
      },
    },
  };

  const outputRaw = solc.compile(JSON.stringify(input));
  const output    = JSON.parse(outputRaw);

  if (output.errors) {
    const fatal = output.errors.filter((e: any) => e.severity === "error");
    if (fatal.length > 0) {
      throw new Error(fatal.map((e: any) => e.formattedMessage).join("\n"));
    }
  }

  const contractOutput = output.contracts?.["JDLFlashReceiver.sol"]?.["JDLFlashReceiver"];
  if (!contractOutput) throw new Error("Contract output missing from solc result");

  const abi      = contractOutput.abi;
  const bytecode = "0x" + contractOutput.evm.bytecode.object;

  // Extract version string from contract if present
  const versionMatch = source.match(/VERSION\s*=\s*"([^"]+)"/);
  const version      = versionMatch ? versionMatch[1] : `${Date.now()}`;

  const solcVersion = solc.version();

  return {
    abi,
    bytecode,
    version,
    contractName:  "JDLFlashReceiver",
    compiledAt:    new Date().toISOString(),
    solcVersion,
    source:        "runtime",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Get the currently active compiled contract (runtime or static). */
export function getCompiledContract(): CompiledContract {
  return state.latest ?? staticFallback();
}

/** Get the full compiler state for the /compiler/status endpoint. */
export function getCompilerStatus() {
  const current = state.latest ?? staticFallback();
  return {
    contractName:  current.contractName,
    version:       current.version,
    solcVersion:   current.solcVersion,
    compiledAt:    current.compiledAt,
    source:        current.source,
    isCompiling:   state.isCompiling,
    lastAttempt:   state.lastAttempt,
    lastError:     state.lastError,
    historyCount:  state.history.length,
    history:       state.history.map(h => ({
      version:    h.version,
      compiledAt: h.compiledAt,
      source:     h.source,
    })),
  };
}

/**
 * Trigger a hot recompile of JDLFlashReceiver.sol.
 * Resolves with the new CompiledContract on success.
 * Falls back to static if solc is unavailable.
 */
export async function rebuildContract(): Promise<CompiledContract> {
  if (state.isCompiling) throw new Error("Compilation already in progress");

  state.isCompiling  = true;
  state.lastAttempt  = new Date().toISOString();
  state.lastError    = null;

  console.log("[Compiler] Starting JDLFlashReceiver.sol compilation...");

  try {
    const compiled = await compileWithSolc();

    // Archive current version if it exists
    if (state.latest) state.history.unshift(state.latest);
    if (state.history.length > 10) state.history.length = 10; // keep last 10

    state.latest = compiled;
    console.log(`[Compiler] Compiled successfully: v${compiled.version} via solc ${compiled.solcVersion}`);
    return compiled;
  } catch (err: any) {
    state.lastError = err.message;
    console.error("[Compiler] Compilation failed:", err.message);
    console.warn("[Compiler] Falling back to static pre-compiled bytecode");
    const fallback = staticFallback();
    if (!state.latest) state.latest = fallback;
    return fallback;
  } finally {
    state.isCompiling = false;
  }
}

/** Initialise the compiler on server start — runs an immediate compile attempt. */
export async function initContractCompiler(): Promise<void> {
  try {
    await rebuildContract();
  } catch {
    console.warn("[Compiler] Init compile failed — using static bytecode");
  }
}
