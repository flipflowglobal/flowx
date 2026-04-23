// src/security.rs — Bytecode-level security pattern detector
use crate::disasm::Disassembly;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity { Critical, High, Medium, Low, Info }

impl std::fmt::Display for Severity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", match self {
            Self::Critical => "CRITICAL", Self::High => "HIGH",
            Self::Medium   => "MEDIUM",   Self::Low  => "LOW",
            Self::Info     => "INFO",
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub severity:    Severity,
    pub title:       String,
    pub description: String,
    pub offset:      Option<usize>,
    pub pattern:     String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecurityReport {
    pub findings:        Vec<Finding>,
    pub has_selfdestruct:bool,
    pub has_delegatecall:bool,
    pub has_create2:     bool,
    pub has_staticcall:  bool,
    pub sstore_count:    usize,
    pub sload_count:     usize,
    pub call_count:      usize,
    pub risk_score:      u32,
}

fn finding(sev: Severity, title: &str, desc: &str, offset: Option<usize>, pattern: &str) -> Finding {
    Finding { severity: sev, title: title.into(), description: desc.into(), offset, pattern: pattern.into() }
}

pub fn analyze_security(disasm: &Disassembly) -> SecurityReport {
    let instrs = &disasm.instructions;
    let mut findings: Vec<Finding> = Vec::new();
    let mut has_selfdestruct = false;
    let mut has_delegatecall = false;
    let mut has_create2      = false;
    let mut has_staticcall   = false;
    let mut sstore_count = 0usize;
    let mut sload_count  = 0usize;
    let mut call_count   = 0usize;
    let n = instrs.len();

    for (i, ins) in instrs.iter().enumerate() {
        match ins.opcode {
            0xff => {
                has_selfdestruct = true;
                let protected = instrs[..i].iter().rev().take(30)
                    .any(|x| x.opcode == 0x33);
                findings.push(finding(
                    if protected { Severity::Medium } else { Severity::Critical },
                    "SELFDESTRUCT present",
                    if protected { "SELFDESTRUCT with apparent access control" }
                    else { "SELFDESTRUCT with no visible access control — funds at risk" },
                    Some(ins.offset), "SELFDESTRUCT"
                ));
            }
            0xf4 => {
                has_delegatecall = true;
                let addr_from_calldata = instrs[..i].iter().rev().take(10)
                    .any(|x| x.opcode == 0x35 || x.opcode == 0x36);
                findings.push(finding(
                    if addr_from_calldata { Severity::Critical } else { Severity::High },
                    "DELEGATECALL detected",
                    if addr_from_calldata { "DELEGATECALL with address from calldata — arbitrary code execution risk" }
                    else { "DELEGATECALL present (proxy or library call — verify target trust)" },
                    Some(ins.offset), "DELEGATECALL"
                ));
            }
            0xf5 => {
                has_create2 = true;
                findings.push(finding(
                    Severity::Info, "CREATE2 detected",
                    "Deterministic deployment — verify salt is not user-controlled",
                    Some(ins.offset), "CREATE2"
                ));
            }
            0xfa => { has_staticcall = true; }
            0x55 => {
                sstore_count += 1;
                let call_before  = instrs[..i].iter().rev().take(50).any(|x| x.opcode == 0xf1 || x.opcode == 0xf4);
                let sstore_before = instrs[..i].iter().rev().take(50).any(|x| x.opcode == 0x55);
                if call_before && !sstore_before {
                    findings.push(finding(
                        Severity::High, "Potential reentrancy: SSTORE after CALL",
                        "State update follows external CALL without prior SSTORE — violates CEI pattern",
                        Some(ins.offset), "SSTORE_AFTER_CALL"
                    ));
                }
            }
            0x54 => { sload_count += 1; }
            0xf1 => {
                call_count += 1;
                if i + 1 < n && instrs[i + 1].opcode == 0x50 {
                    findings.push(finding(
                        Severity::Medium, "Unchecked CALL return value",
                        "Return value of CALL immediately POP'd — failed calls silently ignored",
                        Some(ins.offset), "UNCHECKED_CALL"
                    ));
                }
            }
            0x32 => {
                if i + 2 < n && (instrs[i+1].opcode == 0x14 || instrs[i+2].opcode == 0x14) {
                    findings.push(finding(
                        Severity::High, "tx.origin used for auth",
                        "ORIGIN used in equality check — phishing attack vector",
                        Some(ins.offset), "TX_ORIGIN_AUTH"
                    ));
                }
            }
            0x42 => {
                let next_cmp = i + 1 < n && matches!(instrs[i+1].opcode, 0x10|0x11|0x12|0x13|0x14|0x15);
                if next_cmp {
                    findings.push(finding(
                        Severity::Low, "Block timestamp dependency",
                        "TIMESTAMP used in conditional — miners can manipulate ±15s",
                        Some(ins.offset), "TIMESTAMP_DEPENDENCY"
                    ));
                }
            }
            0x73 => {
                if let Some(ref hex) = ins.imm {
                    if !hex.chars().all(|c| c == '0') {
                        let near_call = instrs[i..].iter().take(10).any(|x| x.opcode == 0xf1);
                        if near_call {
                            findings.push(finding(
                                Severity::Info, "Hardcoded address",
                                &format!("Hardcoded address 0x{hex} — verify deployment intent"),
                                Some(ins.offset), "HARDCODED_ADDRESS"
                            ));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if sstore_count == 0 && call_count > 0 {
        findings.push(finding(Severity::Info, "Stateless contract",
            "No SSTORE — contract holds no state (pure computation or proxy)", None, "STATELESS"));
    }
    if disasm.jumpdests.is_empty() && disasm.total_bytes > 100 {
        findings.push(finding(Severity::Info, "No JUMPDEST — linear execution",
            "No jump destinations — may be a library or minimal proxy", None, "NO_JUMPDEST"));
    }

    let risk: u32 = findings.iter().map(|f| match f.severity {
        Severity::Critical => 30, Severity::High => 15,
        Severity::Medium   => 8,  Severity::Low  => 3,
        Severity::Info     => 1,
    }).sum::<u32>().min(100);

    SecurityReport { findings, has_selfdestruct, has_delegatecall, has_create2,
        has_staticcall, sstore_count, sload_count, call_count, risk_score: risk }
}
