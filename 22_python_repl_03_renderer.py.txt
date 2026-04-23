# repl_03_renderer.py — Human-readable report renderer
# Part 3 of hinsdale_repl — render_report(AnalysisResult) -> str
# Depends on: repl_01_core, repl_02_analysis

from __future__ import annotations
import re, textwrap
from typing import Optional

try:
    from .repl_01_core import (
        C, _W, _backend_name,
        progress_bar, section, badge,
        risk_colour, risk_label, severity_colour,
        hex_dump, cat_col,
    )
    from .repl_02_analysis import AnalysisResult
except ImportError:
    try:
        from repl_01_core import (
            C, _W, _backend_name,
            progress_bar, section, badge,
            risk_colour, risk_label, severity_colour,
            hex_dump, cat_col,
        )
        from repl_02_analysis import AnalysisResult
    except ImportError:
        import importlib.util
        from importlib.machinery import SourceFileLoader
        from pathlib import Path

        _BASE = Path(__file__).resolve().parent

        def _load_local(name: str, filename: str):
            loader = SourceFileLoader(name, str(_BASE / filename))
            spec = importlib.util.spec_from_loader(name, loader)
            mod = importlib.util.module_from_spec(spec)
            assert spec and spec.loader
            spec.loader.exec_module(mod)
            return mod

        _core = _load_local("repl_01_core", "20_python_repl_01_core.py.txt")
        _analysis = _load_local("repl_02_analysis", "21_python_repl_02_analysis.py.txt")

        C = _core.C
        _W = _core._W
        _backend_name = _core._backend_name
        progress_bar = _core.progress_bar
        section = _core.section
        badge = _core.badge
        risk_colour = _core.risk_colour
        risk_label = _core.risk_label
        severity_colour = _core.severity_colour
        hex_dump = _core.hex_dump
        cat_col = _core.cat_col
        AnalysisResult = _analysis.AnalysisResult

def render_report(r: AnalysisResult) -> str:
    """Render a full human-readable colour report. Returns string."""
    lines = []
    W = _W

    def ln(s: str = ""):
        lines.append(s)

    # ── HEADER ────────────────────────────────────────────────────────────
    ln(f"\n{C.CYAN}{'═' * W}{C.RESET}")
    title = "  HINSDALE DECOMPILER — ANALYSIS REPORT"
    ts    = f"  {r.timestamp}  "
    pad   = W - len(title) - len(ts)
    ln(f"{C.BOLD}{C.WHITE}{title}{' ' * max(0, pad)}{C.DIM}{ts}{C.RESET}")
    ln(f"{C.CYAN}{'═' * W}{C.RESET}")

    # ── OVERVIEW ──────────────────────────────────────────────────────────
    ln(section("OVERVIEW", C.CYAN))
    ln()

    rc = risk_colour(r.risk_score)
    col1 = [
        f"  {C.DIM}Bytecode size  {C.RESET}{C.BOLD}{r.bytecode_len:,}{C.RESET} bytes"
        f"  ({r.bytecode_len * 2:,} hex chars)",
        f"  {C.DIM}Analysis time  {C.RESET}{C.BOLD}{r.elapsed_ms:.1f}{C.RESET} ms",
        f"  {C.DIM}Backend        {C.RESET}{C.DIM}{_backend_name}{C.RESET}",
        f"  {C.DIM}Timestamp      {C.RESET}{C.DIM}{r.timestamp}{C.RESET}",
    ]
    col2 = [
        f"  {C.DIM}Instructions   {C.RESET}{C.BOLD}{r.instr_count:,}{C.RESET}",
        f"  {C.DIM}Basic blocks   {C.RESET}{C.BOLD}{r.block_count:,}{C.RESET}"
        f"  ({r.edge_count:,} edges)",
        f"  {C.DIM}JUMPDESTs      {C.RESET}{C.BOLD}{r.jumpdest_count:,}{C.RESET}",
        f"  {C.DIM}Functions      {C.RESET}{C.BOLD}{len(r.functions):,}{C.RESET}",
    ]
    for a, b in zip(col1, col2):
        ln(f"{a:<52}{b}")

    ln()
    ln(progress_bar("Risk Score", r.risk_score / 100, colour=rc))
    ln(f"  {C.DIM}Risk           {C.RESET}{rc}{C.BOLD}{r.risk_score}/100"
       f"  {risk_label(r.risk_score)}{C.RESET}")

    # Contract type badges
    tags = []
    if r.is_runtime:       tags.append(badge("RUNTIME",      C.GREEN))
    else:                  tags.append(badge("CREATION",     C.YELLOW))
    if r.is_proxy:         tags.append(badge("PROXY",        C.ORANGE))
    if r.is_erc20:         tags.append(badge("ERC-20",       C.TEAL))
    if r.is_erc721:        tags.append(badge("ERC-721",      C.PURPLE))
    if r.has_selfdestruct: tags.append(badge("SELFDESTRUCT", C.RED))
    if r.has_delegatecall: tags.append(badge("DELEGATECALL", C.ORANGE))
    if r.has_create2:      tags.append(badge("CREATE2",      C.MAGENTA))
    if r.solc_hint:        tags.append(badge(f"solc {r.solc_hint}", C.DIM))
    if tags:
        ln(f"\n  {' '.join(tags)}")

    ln()
    ln(f"  {C.DIM}Bytecode preview:{C.RESET}")
    ln(hex_dump(r.raw_bytes, cols=16, max_rows=3))
    ln()

    stats = [("SLOAD", r.sload_count, C.BLUE),
             ("SSTORE", r.sstore_count, C.ORANGE),
             ("CALL", r.call_count, C.RED)]
    parts = [f"{col}{C.BOLD}{count}{C.RESET} {C.DIM}{label}{C.RESET}"
             for label, count, col in stats]
    ln(f"  {C.DIM}Storage/Call   {C.RESET}{'   '.join(parts)}")

    # ── FUNCTION SIGNATURES ───────────────────────────────────────────────
    ln(section("FUNCTION SIGNATURES", C.BLUE))
    ln()

    if not r.functions:
        ln(f"  {C.DIM}No dispatcher pattern detected.{C.RESET}")
        ln(f"  {C.DIM}May be: library, minimal proxy, or pure computation.{C.RESET}")
    else:
        ln(f"  {C.DIM}{'SELECTOR':<14}{'JUMPS TO':<12}{'MUTABILITY':<12}SIGNATURE{C.RESET}")
        ln(f"  {C.DIM}{'─'*14}{'─'*12}{'─'*12}{'─'*40}{C.RESET}")

        for fn in r.functions:
            sel     = getattr(fn, 'selector',    '?')
            name    = getattr(fn, 'known_name',  None) or "??? (unknown selector)"
            tgt     = getattr(fn, 'jump_target', None)
            is_view = getattr(fn, 'is_view',     False)

            tgt_str = f"0x{tgt:04x}" if tgt is not None else "    ?"
            mut_str = (f"{C.TEAL}view{C.RESET}  " if is_view
                       else f"{C.ORANGE}write{C.RESET} ")

            if any(x in name for x in ("transfer", "approve")):
                name_col = C.ORANGE
            elif any(x in name.lower() for x in ("owner", "only")):
                name_col = C.YELLOW
            elif any(x in name.lower() for x in ("view", "get", "balance")):
                name_col = C.TEAL
            elif any(x in name for x in ("flash", "arbitrage")):
                name_col = C.MAGENTA
            else:
                name_col = C.WHITE

            ln(f"  {C.CYAN}{sel:<14}{C.RESET}"
               f"{C.DIM}{tgt_str:<12}{C.RESET}"
               f"{mut_str:<12}"
               f"{name_col}{name}{C.RESET}")

    if r.event_topics:
        ln()
        ln(f"  {C.DIM}Event topics:{C.RESET}")
        for t in r.event_topics[:8]:
            ln(f"    {C.MAGENTA}{t}{C.RESET}")

    # ── SECURITY AUDIT ────────────────────────────────────────────────────
    rc2 = C.RED if r.risk_score >= 30 else C.YELLOW
    ln(section("SECURITY AUDIT", rc2))
    ln()

    gauge_w = 40
    filled  = int((r.risk_score / 100) * gauge_w)
    gauge   = (f"{C.RED}{'█' * min(filled,15)}"
               f"{C.ORANGE}{'█' * min(max(filled-15,0),15)}"
               f"{C.YELLOW}{'█' * min(max(filled-30,0),10)}"
               f"{C.DIM}{'░' * (gauge_w-filled)}{C.RESET}")
    ln(f"  Risk Gauge  {gauge}  "
       f"{risk_colour(r.risk_score)}{C.BOLD}{r.risk_score}/100"
       f"  {risk_label(r.risk_score)}{C.RESET}")
    ln()

    flags = [("SELFDESTRUCT", r.has_selfdestruct),
             ("DELEGATECALL", r.has_delegatecall),
             ("CREATE2",      r.has_create2)]
    flag_parts = [
        f"{'✖' if p else '✔'} {n}"
        for n, p in flags
    ]
    # colour each
    flag_coloured = []
    for (name2, present), part in zip(flags, flag_parts):
        col = C.RED if present else C.GREEN
        flag_coloured.append(f"{col}{part}{C.RESET}")
    ln("  " + "   ".join(flag_coloured))
    ln()

    if not r.findings:
        ln(f"  {C.GREEN}✔  No security issues detected.{C.RESET}")
    else:
        severity_order = ["CRITICAL","HIGH","MEDIUM","LOW","INFO"]
        grouped = {}
        for f in r.findings:
            sev = getattr(f,'severity','INFO').upper()
            grouped.setdefault(sev,[]).append(f)

        for sev in severity_order:
            if sev not in grouped: continue
            sc = severity_colour(sev)
            ln(f"  {sc}{C.BOLD}▌▌ {sev}{C.RESET}")
            for f in grouped[sev]:
                title = getattr(f,'title','?')
                desc  = getattr(f,'description','')
                off   = getattr(f,'offset',None)
                pat   = getattr(f,'pattern','')
                loc   = f"offset 0x{off:04x}" if off is not None else "—"
                ln(f"    {sc}▸{C.RESET} {C.BOLD}{title}{C.RESET}"
                   f"  {C.DIM}@ {loc}{C.RESET}")
                wrapped = textwrap.fill(desc, width=W-8,
                                        initial_indent="      ",
                                        subsequent_indent="      ")
                ln(f"{C.DIM}{wrapped}{C.RESET}")
                if pat:
                    ln(f"      {C.DIM}Pattern: {C.PURPLE}{pat}{C.RESET}")
                ln()

    # ── DISASSEMBLY (first 60) ────────────────────────────────────────────
    ln(section("DISASSEMBLY", C.TEAL))
    ln()

    instrs = r.instructions
    if not instrs:
        ln(f"  {C.DIM}No instructions decoded.{C.RESET}")
    else:
        total = len(instrs)
        shown = min(60, total)
        ln(f"  {C.DIM}Showing first {shown} of {total:,} instructions{C.RESET}"
           + (f"  {C.DIM}(use disasm command for all){C.RESET}" if total > shown else ""))
        ln()
        ln(f"  {C.DIM}{'OFFSET':<8} {'OP':<4} {'MNEMONIC':<14} {'IMM / NOTES':<30} STACK{C.RESET}")
        ln(f"  {C.DIM}{'─'*8} {'─'*4} {'─'*14} {'─'*30} {'─'*10}{C.RESET}")

        for ins in instrs[:shown]:
            off     = getattr(ins,'offset',0)
            op      = getattr(ins,'opcode',0)
            mn      = getattr(ins,'mnemonic','?')
            imm_hex = getattr(ins,'imm_hex','') or ''
            imm_u64 = getattr(ins,'imm_u64',None)
            cat     = getattr(ins,'category','') or ''
            sin     = getattr(ins,'stack_in',0)
            sout    = getattr(ins,'stack_out',0)
            is_jd   = getattr(ins,'is_jumpdest', op==0x5b)
            col     = cat_col(cat)

            if imm_hex:
                if op == 0x73 and len(imm_hex) == 40:
                    imm_display = f"addr 0x{imm_hex[:8]}…"
                elif op in (0x60,0x61,0x62,0x63) and imm_u64 is not None:
                    imm_display = f"0x{imm_hex}  ({imm_u64})"
                elif op == 0x7f and len(imm_hex) == 64:
                    imm_display = f"0x{imm_hex[:16]}… (topic)"
                else:
                    imm_display = f"0x{imm_hex[:24]}{'…' if len(imm_hex)>24 else ''}"
            else:
                imm_display = ""

            stack_ann = (f"{C.DIM}↓{sin} ↑{sout}{C.RESET}"
                         if sin > 0 or sout > 0 else "")
            marker = f"{C.GREEN}◆{C.RESET}" if is_jd else " "

            ln(f"  {marker} {C.DIM}0x{off:04x}{C.RESET}  "
               f"{C.DIM}{op:02x}{C.RESET}   "
               f"{col}{C.BOLD}{mn:<14}{C.RESET}"
               f"{C.DIM}{imm_display:<32}{C.RESET}"
               f"{stack_ann}")

        if total > shown:
            ln(f"\n  {C.DIM}… {total-shown:,} more instructions …{C.RESET}")

    # ── OPCODE FREQUENCY ──────────────────────────────────────────────────
    if r.opcode_freq:
        ln(section("OPCODE FREQUENCY (TOP 15)", C.PURPLE))
        ln()
        max_count = max(r.opcode_freq.values())
        bar_w     = 25
        _arith    = {"ADD","MUL","SUB","DIV","MOD","EXP"}
        _flow     = {"JUMP","JUMPI","JUMPDEST"}
        _store    = {"SLOAD","SSTORE"}
        _mem      = {"MLOAD","MSTORE"}
        _sys      = {"CALL","RETURN","REVERT"}

        for mn, count in list(r.opcode_freq.items())[:15]:
            frac = count / max_count
            bar  = "█" * int(frac * bar_w) + "░" * (bar_w - int(frac * bar_w))
            if mn.startswith("PUSH"): col = C.TEAL
            elif any(mn.startswith(op) for op in _arith): col = C.YELLOW
            elif any(mn.startswith(op) for op in _flow):  col = C.GREEN
            elif any(mn.startswith(op) for op in _store): col = C.ORANGE
            elif any(mn.startswith(op) for op in _sys):   col = C.RED
            else: col = C.DIM
            ln(f"  {C.BOLD}{mn:<14}{C.RESET} {col}{bar}{C.RESET} {count:>6,}")

    # ── DECOMPILED SOURCE ─────────────────────────────────────────────────
    ln(section("DECOMPILED PSEUDO-SOLIDITY", C.MAGENTA))
    ln()

    src = r.pseudo_source or ""
    if not src or src.startswith("["):
        ln(f"  {C.DIM}{src or 'No source recovered.'}{C.RESET}")
    else:
        ln(f"  {C.DIM}{'─' * (W-4)}{C.RESET}")
        for raw_line in src.splitlines():
            stripped = raw_line.rstrip()
            if not stripped:
                ln(); continue
            coloured = stripped
            for kw in ["function","external","internal","view","payable",
                       "returns","pragma","contract","interface","mapping",
                       "require","revert","return","if","emit","public",
                       "address","uint256","uint","bool","bytes","string"]:
                coloured = re.sub(rf'\b{kw}\b',
                                  f"{C.BLUE}{kw}{C.RESET}", coloured)
            if "//" in coloured:
                idx      = coloured.index("//")
                coloured = coloured[:idx] + f"{C.DIM}{coloured[idx:]}{C.RESET}"
            coloured = re.sub(r'(0x[0-9a-fA-F]+)',
                               f"{C.CYAN}\\1{C.RESET}", coloured)
            coloured = re.sub(r'(".*?")',
                               f"{C.YELLOW}\\1{C.RESET}", coloured)
            coloured = re.sub(r'(?<![0-9a-fA-Fx])(\b[0-9]+\b)(?![0-9a-fA-F])',
                               f"{C.TEAL}\\1{C.RESET}", coloured)
            ln(f"  {coloured}")
        ln(f"  {C.DIM}{'─' * (W-4)}{C.RESET}")
        ln(f"\n  {C.DIM}⚠  Reconstructed — not guaranteed to compile.{C.RESET}")

    # ── FOOTER ────────────────────────────────────────────────────────────
    ln()
    ln(f"{C.CYAN}{'═' * W}{C.RESET}")
    ln(f"  {C.DIM}Complete  │  {r.elapsed_ms:.1f}ms  │  "
       f"{r.instr_count:,} instrs  │  "
       f"risk {r.risk_score}/100  │  "
       f"{len(r.findings)} findings{C.RESET}")
    ln(f"{C.CYAN}{'═' * W}{C.RESET}")
    ln()

    return "\n".join(lines)
