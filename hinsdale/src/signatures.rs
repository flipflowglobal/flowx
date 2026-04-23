// src/signatures.rs — Function dispatcher pattern recovery
use crate::disasm::Disassembly;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionSig {
    pub selector:     String,
    pub selector_u32: u32,
    pub known_name:   Option<String>,
    pub jump_target:  Option<usize>,
    pub is_view:      bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SignatureReport {
    pub functions:       Vec<FunctionSig>,
    pub event_topics:    Vec<String>,
    pub has_dispatcher:  bool,
    pub fallback_offset: Option<usize>,
}

fn builtin_4byte(sel: u32) -> Option<&'static str> {
    match sel {
        // ERC-20
        0x06fdde03 => Some("name()"),
        0x095ea7b3 => Some("approve(address,uint256)"),
        0x18160ddd => Some("totalSupply()"),
        0x23b872dd => Some("transferFrom(address,address,uint256)"),
        0x313ce567 => Some("decimals()"),
        0x39509351 => Some("increaseAllowance(address,uint256)"),
        0x40c10f19 => Some("mint(address,uint256)"),
        0x42966c68 => Some("burn(uint256)"),
        0x70a08231 => Some("balanceOf(address)"),
        0x79cc6790 => Some("burnFrom(address,uint256)"),
        0x95d89b41 => Some("symbol()"),
        0xa0712d68 => Some("mint(uint256)"),
        0xa9059cbb => Some("transfer(address,uint256)"),
        0xdd62ed3e => Some("allowance(address,address)"),
        // Ownable
        0x715018a6 => Some("renounceOwnership()"),
        0x8da5cb5b => Some("owner()"),
        0xf2fde38b => Some("transferOwnership(address)"),
        // Pausable
        0x8456cb59 => Some("pause()"),
        0x3f4ba83a => Some("unpause()"),
        0x5c975abb => Some("paused()"),
        // Access control
        0xa217fddf => Some("DEFAULT_ADMIN_ROLE()"),
        0xd547741f => Some("revokeRole(bytes32,address)"),
        0x2f2ff15d => Some("grantRole(bytes32,address)"),
        0x91d14854 => Some("hasRole(bytes32,address)"),
        // ERC-721
        0x6352211e => Some("ownerOf(uint256)"),
        0xb88d4fde => Some("safeTransferFrom(address,address,uint256,bytes)"),
        0xc87b56dd => Some("tokenURI(uint256)"),
        0xa22cb465 => Some("setApprovalForAll(address,bool)"),
        // ERC-1155
        0xf242432a => Some("safeTransferFrom(address,address,uint256,uint256,bytes)"),
        0x2eb2c2d6 => Some("safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)"),
        // Proxy / Upgradeable
        0x4f1ef286 => Some("upgradeToAndCall(address,bytes)"),
        0x52d1902d => Some("proxiableUUID()"),
        0x3659cfe6 => Some("upgradeTo(address)"),
        0xf851a440 => Some("admin()"),
        // Finance / withdrawal
        0x2e1a7d4d => Some("withdraw(uint256)"),
        0x3ccfd60b => Some("withdraw()"),
        0xd0e30db0 => Some("deposit()"),
        0xe63d38ed => Some("withdraw(uint256)"),
        0x4782f779 => Some("withdrawTo(address,uint256)"),
        // Flash loans
        0x42b0b77c => Some("flashLoanSimple(address,address,uint256,bytes,uint16)"),
        0x1b11d0ff => Some("executeOperation(address,uint256,uint256,address,bytes)"),
        0xab9c4b5d => Some("flashLoan(address,address[],uint256[],uint256[],address,bytes,uint16)"),
        // Aave V3
        0xe8eda9df => Some("supply(address,uint256,address,uint16)"),
        0x69328dec => Some("withdraw(address,uint256,address)"),
        0x573ade81 => Some("repay(address,uint256,uint256,address)"),
        0x617ba037 => Some("borrow(address,uint256,uint256,uint16,address)"),
        0x96cd4ddb => Some("liquidationCall(address,address,address,uint256,bool)"),
        // Uniswap V3
        0x128acb08 => Some("swap(address,bool,int256,uint160,bytes)"),
        0x1a686502 => Some("liquidity()"),
        0x514ea4bf => Some("ticks(int24)"),
        0x3850c7bd => Some("slot0()"),
        0xac9650d8 => Some("multicall(bytes[])"),
        0x5ae401dc => Some("multicall(uint256,bytes[])"),
        // Uniswap V2
        0x0902f1ac => Some("getReserves()"),
        0x38ed1739 => Some("swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"),
        0x7ff36ab5 => Some("swapExactETHForTokens(uint256,address[],address,uint256)"),
        0x18cbafe5 => Some("swapExactTokensForETH(uint256,uint256,address[],address,uint256)"),
        // Compound
        0xdb006a75 => Some("redeem(uint256)"),
        0x852a12e3 => Some("redeemUnderlying(uint256)"),
        0x3af9e669 => Some("borrowBalanceCurrent(address)"),
        // Chainlink oracle
        0xfeaf968c => Some("latestRoundData()"),
        0x50d25bcd => Some("latestAnswer()"),
        0x9a6fc8f5 => Some("getRoundData(uint80)"),
        // ERC-4626 vault
        0x07a2d13a => Some("convertToAssets(uint256)"),
        0xb3d7f6b9 => Some("convertToShares(uint256)"),
        0xd905777e => Some("maxDeposit(address)"),
        0xef8b30f7 => Some("previewDeposit(uint256)"),
        0xb460af94 => Some("withdraw(uint256,address,address)"),
        // Governance
        0x56781388 => Some("castVote(uint256,uint8)"),
        0x7d5e81e2 => Some("propose(address[],uint256[],bytes[],string)"),
        // Staking
        0x4e71d92d => Some("claim()"),
        0xa694fc3a => Some("stake(uint256)"),
        0x7b0a47ee => Some("rewardPerToken()"),
        // Misc DeFi
        0x2301d775 => Some("profitWallet()"),
        0xda2ca9b5 => Some("rescue(address)"),
        0x839006f2 => Some("flash(address,uint256)"),
        _ => None,
    }
}

pub fn recover_signatures(disasm: &Disassembly) -> SignatureReport {
    let instrs = &disasm.instructions;
    let mut functions: Vec<FunctionSig> = Vec::new();
    let mut event_topics: Vec<String>   = Vec::new();
    let mut has_dispatcher = false;
    let mut fallback_offset: Option<usize> = None;
    let mut seen: FxHashMap<u32, usize>    = FxHashMap::default();
    let n = instrs.len();

    for i in 0..n.saturating_sub(2) {
        let ins = &instrs[i];
        // PUSH4 → selector candidate
        if ins.opcode == 0x63 {
            if let Some(val) = ins.imm_u256 {
                let sel = val as u32;
                let window_end = (i + 6).min(n);
                let window = &instrs[i + 1..window_end];
                let has_eq   = window.iter().any(|x| x.opcode == 0x14);
                let has_jumpi = window.iter().any(|x| x.opcode == 0x57);
                if has_eq && has_jumpi {
                    has_dispatcher = true;
                    let jump_target = window.windows(2)
                        .find(|w| w[1].opcode == 0x57 && (0x60..=0x7f).contains(&w[0].opcode))
                        .and_then(|w| w[0].imm_u256)
                        .map(|v| v as usize);
                    if !seen.contains_key(&sel) {
                        seen.insert(sel, functions.len());
                        functions.push(FunctionSig {
                            selector:     format!("0x{:08x}", sel),
                            selector_u32: sel,
                            known_name:   builtin_4byte(sel).map(str::to_string),
                            jump_target,
                            is_view:      false,
                        });
                    }
                }
            }
        }
        // PUSH32 near LOG → event topic
        if ins.opcode == 0x7f {
            let nearby_log = instrs[i..].iter().take(6)
                .any(|x| (0xa0..=0xa4).contains(&x.opcode));
            if nearby_log {
                if let Some(ref hex) = ins.imm {
                    let t = format!("0x{}", hex);
                    if !event_topics.contains(&t) { event_topics.push(t); }
                }
            }
        }
    }

    if let Some(last_jumpi) = instrs.iter().rev().find(|x| x.opcode == 0x57) {
        fallback_offset = Some(last_jumpi.offset);
    }

    SignatureReport { functions, event_topics, has_dispatcher, fallback_offset }
}
