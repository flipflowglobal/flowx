// src/main.rs — Hinsdale CLI

use std::io::{self, Read};
use std::path::PathBuf;
use std::process;

fn usage() {
    eprintln!(
"╔═══════════════════════════════════════════════════════════════╗
║          HINSDALE EVM DECOMPILER v1.0  (Aureon/DL)           ║
╠═══════════════════════════════════════════════════════════════╣
║  USAGE                                                        ║
║  hinsdale-cli <bytecode_hex>          # from argument         ║
║  hinsdale-cli --file <path.bin>       # from binary file      ║
║  hinsdale-cli --hex-file <path.hex>   # from hex text file    ║
║  echo <hex> | hinsdale-cli            # from stdin            ║
║                                                               ║
║  FLAGS                                                        ║
║  --json          emit full JSON report                        ║
║  --disasm-only   disassembly only (fastest)                   ║
║  --no-decompile  skip pseudo-source output                    ║
║  --security-only security report only                        ║
║  --sigs-only     function signatures only                     ║
║  --summary       one-line summary                             ║
╚═══════════════════════════════════════════════════════════════╝"
    );
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() == 1 || args.iter().any(|a| a == "--help" || a == "-h") {
        usage();
        process::exit(0);
    }

    // Parse flags
    let emit_json     = args.iter().any(|a| a == "--json");
    let disasm_only   = args.iter().any(|a| a == "--disasm-only");
    let no_decompile  = args.iter().any(|a| a == "--no-decompile");
    let security_only = args.iter().any(|a| a == "--security-only");
    let sigs_only     = args.iter().any(|a| a == "--sigs-only");
    let summary_only  = args.iter().any(|a| a == "--summary");

    // Determine input source
    let bytecode: Vec<u8> = {
        if let Some(pos) = args.iter().position(|a| a == "--file") {
            let path = args.get(pos + 1).unwrap_or_else(|| {
                eprintln!("[ERROR] --file requires a path argument");
                process::exit(1);
            });
            std::fs::read(PathBuf::from(path)).unwrap_or_else(|e| {
                eprintln!("[ERROR] Cannot read file: {e}");
                process::exit(1);
            })
        } else if let Some(pos) = args.iter().position(|a| a == "--hex-file") {
            let path = args.get(pos + 1).unwrap_or_else(|| {
                eprintln!("[ERROR] --hex-file requires a path argument");
                process::exit(1);
            });
            let hex = std::fs::read_to_string(PathBuf::from(path)).unwrap_or_else(|e| {
                eprintln!("[ERROR] Cannot read hex file: {e}");
                process::exit(1);
            });
            hinsdale::parse_hex(&hex).unwrap_or_else(|e| {
                eprintln!("[ERROR] {e}");
                process::exit(1);
            })
        } else {
            // Try first non-flag argument as hex, else stdin
            let hex_arg = args.iter().skip(1)
                .find(|a| !a.starts_with('-'));

            let hex_str = if let Some(h) = hex_arg {
                h.clone()
            } else {
                let mut buf = String::new();
                io::stdin().read_to_string(&mut buf).unwrap_or_default();
                buf
            };

            hinsdale::parse_hex(&hex_str).unwrap_or_else(|e| {
                eprintln!("[ERROR] {e}");
                usage();
                process::exit(1);
            })
        }
    };

    if bytecode.is_empty() {
        eprintln!("[ERROR] Empty bytecode");
        process::exit(1);
    }

    // ── Run analysis ───────────────────────────────────────────────────────
    let report = hinsdale::analyze(&bytecode);

    if emit_json {
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
        return;
    }

    // ── Human-readable output ──────────────────────────────────────────────

    if summary_only {
        println!(
            "HINSDALE │ {} bytes │ {} instrs │ {} blocks │ {} fns │ {} findings │ risk={}  ({:.1}ms)",
            report.metadata.bytecode_len,
            report.disassembly.instruction_count,
            report.cfg_summary.block_count,
            report.signatures.functions.len(),
            report.security.findings.len(),
            report.security.risk_score,
            report.elapsed_ms,
        );
        return;
    }

    // Banner
    println!("╔══════════════════════════════════════════════════════════════════╗");
    println!("║            HINSDALE EVM DECOMPILER — ANALYSIS REPORT            ║");
    println!("╚══════════════════════════════════════════════════════════════════╝");
    println!();

    // ── Metadata ──────────────────────────────────────────────────────────
    println!("── METADATA ─────────────────────────────────────────────────────");
    println!("  Bytecode size   : {} bytes ({} hex chars)", report.metadata.bytecode_len, report.metadata.bytecode_len * 2);
    println!("  Runtime code    : {}", if report.metadata.is_runtime { "YES" } else { "NO (may be creation bytecode)" });
    if let Some(ref v) = report.metadata.solc_version_hint {
        println!("  Solc version    : {v}");
    }
    println!("  Is proxy        : {}", report.metadata.is_proxy);
    println!("  ERC-20 like     : {}", report.metadata.is_erc20_like);
    println!("  ERC-721 like    : {}", report.metadata.is_erc721_like);
    println!("  Analysis time   : {:.2}ms", report.elapsed_ms);
    println!();

    if disasm_only {
        print_disassembly(&report);
        return;
    }

    // ── CFG Summary ───────────────────────────────────────────────────────
    println!("── CONTROL FLOW GRAPH ───────────────────────────────────────────");
    println!("  Instructions    : {}", report.disassembly.instruction_count);
    println!("  Basic blocks    : {}", report.cfg_summary.block_count);
    println!("  CFG edges       : {}", report.cfg_summary.edge_count);
    println!("  Jump dests      : {}", report.cfg_summary.jumpdest_count);
    println!();

    if !sigs_only && !security_only {
        print_disassembly(&report);
    }

    // ── Signatures ────────────────────────────────────────────────────────
    println!("── FUNCTION SIGNATURES ──────────────────────────────────────────");
    if report.signatures.functions.is_empty() {
        println!("  (no dispatcher pattern detected)");
    } else {
        for f in &report.signatures.functions {
            let name = f.known_name.as_deref().unwrap_or("??? (unknown selector)");
            let target = f.jump_target.map(|t| format!("→ 0x{t:04x}"))
                .unwrap_or_else(|| "→ ?".into());
            println!("  {} {}  {}", f.selector, target, name);
        }
    }
    if !report.signatures.event_topics.is_empty() {
        println!();
        println!("  Event topics (PUSH32 near LOG):");
        for t in &report.signatures.event_topics {
            println!("    {t}");
        }
    }
    println!();

    if sigs_only { return; }

    // ── Security ──────────────────────────────────────────────────────────
    println!("── SECURITY ANALYSIS ────────────────────────────────────────────");
    println!("  Risk score      : {}/100", report.security.risk_score);
    println!("  SELFDESTRUCT    : {}", report.security.has_selfdestruct);
    println!("  DELEGATECALL    : {}", report.security.has_delegatecall);
    println!("  CREATE2         : {}", report.security.has_create2);
    println!("  CALL count      : {}", report.security.call_count);
    println!("  SSTORE count    : {}", report.security.sstore_count);
    println!("  SLOAD count     : {}", report.security.sload_count);
    println!();
    if report.security.findings.is_empty() {
        println!("  No security findings.");
    } else {
        for f in &report.security.findings {
            println!("  [{:8}] {} (offset: {})",
                f.severity.to_string(),
                f.title,
                f.offset.map(|o| format!("0x{o:04x}")).unwrap_or_else(|| "—".into())
            );
            println!("             {}", f.description);
        }
    }
    println!();

    if security_only { return; }

    // ── Pseudo-source ─────────────────────────────────────────────────────
    if !no_decompile {
        println!("── PSEUDO-SOLIDITY SOURCE ───────────────────────────────────────");
        println!();
        println!("{}", report.decompiled.pseudo_source);
    }
}

fn print_disassembly(report: &hinsdale::HinsdaleReport) {
    println!("── DISASSEMBLY ───────────────────────────────────────────────────");
    let jumpdest_set: std::collections::HashSet<usize> =
        report.disassembly.jumpdests.iter().copied().collect();

    for ins in &report.disassembly.instructions {
        let marker = if ins.opcode == 0x5b { "◆" } else { " " };
        let imm = ins.imm.as_deref().map(|h| format!(" 0x{h}")).unwrap_or_default();
        // Flag jumps that target valid destinations
        let jump_ann = if (ins.opcode == 0x56 || ins.opcode == 0x57) {
            " ⤵"
        } else { "" };
        println!("  {marker} 0x{:04x}  {:02x}  {:<14}{}{}", ins.offset, ins.opcode, ins.mnemonic, imm, jump_ann);
    }
    println!();
}
