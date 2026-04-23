// src/lib.rs — Hinsdale EVM Decompiler — Public API

pub mod opcodes;
pub mod disasm;
pub mod cfg;
pub mod signatures;
pub mod security;
pub mod types;
pub mod symbolic;
pub mod decompiler;
pub mod ffi;

use serde::{Deserialize, Serialize};
use std::time::Instant;

/// Full decompilation result from a single `analyze()` call.
#[derive(Debug, Serialize, Deserialize)]
pub struct HinsdaleReport {
    pub metadata:     Metadata,
    pub disassembly:  disasm::Disassembly,
    pub cfg_summary:  CfgSummary,
    pub signatures:   signatures::SignatureReport,
    pub security:     security::SecurityReport,
    pub decompiled:   decompiler::DecompiledOutput,
    pub elapsed_ms:   f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Metadata {
    pub bytecode_len:     usize,
    pub is_runtime:       bool,    // heuristic: starts with PUSH1 0x60 PUSH1 0x40
    pub solc_version_hint: Option<String>,
    pub is_proxy:         bool,
    pub is_erc20_like:    bool,
    pub is_erc721_like:   bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CfgSummary {
    pub block_count:     usize,
    pub edge_count:      usize,
    pub jumpdest_count:  usize,
}

/// Parse hex bytecode string (with or without 0x prefix).
pub fn parse_hex(input: &str) -> Result<Vec<u8>, String> {
    let clean = input.trim().trim_start_matches("0x");
    // Strip constructor args if bytecode ends with ABI-padded data
    hex::decode(clean).map_err(|e| format!("hex decode error: {e}"))
}

/// Run the full Hinsdale analysis pipeline on raw bytes.
pub fn analyze(bytecode: &[u8]) -> HinsdaleReport {
    let t0 = Instant::now();

    // 1. Disassemble
    let disassembly = disasm::disassemble(bytecode);

    // 2. CFG
    let cfg = cfg::build_cfg(&disassembly);
    let cfg_summary = CfgSummary {
        block_count:    cfg.block_count(),
        edge_count:     cfg.edge_count(),
        jumpdest_count: disassembly.jumpdests.len(),
    };

    // 3. Signatures
    let signatures = signatures::recover_signatures(&disassembly);

    // 4. Security
    let security = security::analyze_security(&disassembly);

    // 5. Decompile
    let decompiled = decompiler::decompile(&disassembly, &cfg, &signatures);

    // 6. Metadata heuristics
    let is_runtime = bytecode.len() >= 3
        && bytecode[0] == 0x60
        && bytecode[1] == 0x80
        && bytecode[2] == 0x60;

    let is_erc20_like = signatures.functions.iter().any(|f| {
        f.known_name.as_deref().map(|n| {
            n.contains("transfer") || n.contains("balanceOf") || n.contains("approve")
        }).unwrap_or(false)
    });

    let is_erc721_like = signatures.functions.iter().any(|f| {
        f.known_name.as_deref().map(|n| {
            n.contains("tokenURI") || n.contains("ownerOf") || n.contains("safeTransfer")
        }).unwrap_or(false)
    });

    // Simple proxy detection: tiny bytecode with DELEGATECALL
    let is_proxy = security.has_delegatecall && bytecode.len() < 500;

    // Solc version hint: look for PUSH1 0x XX patterns in metadata suffix
    let solc_version_hint = extract_solc_version(bytecode);

    let metadata = Metadata {
        bytecode_len: bytecode.len(),
        is_runtime,
        solc_version_hint,
        is_proxy,
        is_erc20_like,
        is_erc721_like,
    };

    HinsdaleReport {
        metadata,
        disassembly,
        cfg_summary,
        signatures,
        security,
        decompiled,
        elapsed_ms: t0.elapsed().as_secs_f64() * 1000.0,
    }
}

/// EVM bytecode often ends with CBOR-encoded compiler metadata.
/// The last 2 bytes are the CBOR length. Bytes before that may contain
/// the Solidity version string bzzr0/bzzr1/ipfs.
fn extract_solc_version(bytecode: &[u8]) -> Option<String> {
    let n = bytecode.len();
    if n < 4 { return None; }

    // Read last 2 bytes as big-endian metadata length
    let meta_len = u16::from_be_bytes([bytecode[n-2], bytecode[n-1]]) as usize;
    if meta_len + 2 > n || meta_len < 5 { return None; }

    let meta_slice = &bytecode[n - 2 - meta_len .. n - 2];

    // Look for CBOR map key 0x64 "solc" (0xa1 0x64 "solc" 0x43 <3 bytes>)
    // or the ASCII bytes for "solc"
    if let Some(pos) = meta_slice.windows(4).position(|w| w == b"solc") {
        let after = &meta_slice[pos + 4..];
        if after.len() >= 4 {
            let major = after[1];
            let minor = after[2];
            let patch = after[3];
            if major <= 1 && minor <= 20 {
                return Some(format!("^0.{minor}.{patch}"));
            }
        }
    }

    // Fallback: scan for 0x00 0x82 pattern common in ipfs metadata
    if meta_slice.iter().any(|&b| b == 0xa2 || b == 0xa1) {
        return Some("(solc metadata detected, version unreadable)".into());
    }

    None
}
