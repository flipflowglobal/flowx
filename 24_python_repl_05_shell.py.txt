# repl_05_shell.py — Interactive REPL shell + CLI entry point
# Part 5 of hinsdale_repl — the main() and repl() loop
# Depends on: repl_01_core through repl_04_session

from __future__ import annotations
import os, re, sys, textwrap
from pathlib import Path
from typing import Optional

try:
    from .repl_01_core import C, _W, _backend_name, section, risk_colour, risk_label, cat_col
    from .repl_02_analysis import AnalysisResult
    from .repl_03_renderer import render_report
    from .repl_04_session import Session, run_analysis_live, save_report
except ImportError:
    import importlib.util
    from importlib.machinery import SourceFileLoader

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
    _renderer = _load_local("repl_03_renderer", "22_python_repl_03_renderer.py.txt")
    _session = _load_local("repl_04_session", "23_python_repl_04_session.py.txt")

    C = _core.C
    _W = _core._W
    _backend_name = _core._backend_name
    section = _core.section
    risk_colour = _core.risk_colour
    risk_label = _core.risk_label
    cat_col = _core.cat_col
    AnalysisResult = _analysis.AnalysisResult
    render_report = _renderer.render_report
    Session = _session.Session
    run_analysis_live = _session.run_analysis_live
    save_report = _session.save_report

try:
    import readline  # arrow keys + history
except ImportError:
    pass

# ── Help text ─────────────────────────────────────────────────────────────

HELP_TEXT = f"""
{C.BOLD}HINSDALE DECOMPILER — COMMANDS{C.RESET}

  {C.CYAN}<hex>{C.RESET}              Analyze bytecode (0x prefix optional, multi-line OK)
  {C.CYAN}file <path>{C.RESET}        Load .bin (raw bytes) or .hex (text) file
  {C.CYAN}last{C.RESET}               Re-display last analysis report
  {C.CYAN}save{C.RESET}               Save last report to timestamped .txt file
  {C.CYAN}save <path>{C.RESET}        Save last report to specified file
  {C.CYAN}history{C.RESET}            Show session analysis log
  {C.CYAN}disasm{C.RESET}             Full disassembly of last analysis
  {C.CYAN}source{C.RESET}             Pseudo-Solidity source of last analysis
  {C.CYAN}security{C.RESET}           Security findings of last analysis
  {C.CYAN}sigs{C.RESET}               Function signatures of last analysis
  {C.CYAN}clear{C.RESET}              Clear terminal screen
  {C.CYAN}backend{C.RESET}            Show active analysis backend
  {C.CYAN}help{C.RESET}               Show this help
  {C.CYAN}quit / exit / q{C.RESET}    Exit

  {C.DIM}Paste hex across multiple lines — blank line to submit.{C.RESET}
  {C.DIM}Ctrl+C during analysis: waits for result before stopping.{C.RESET}
"""

# ── Banner ────────────────────────────────────────────────────────────────

def _print_banner():
    W = _W
    print()
    print(f"{C.CYAN}{'╔' + '═'*(W-2) + '╗'}{C.RESET}")
    print(f"{C.CYAN}║{C.RESET}"
          f"{C.BOLD}{C.WHITE}{'HINSDALE  EVM  DECOMPILER  v2.0':^{W-2}}{C.RESET}"
          f"{C.CYAN}║{C.RESET}")
    print(f"{C.CYAN}║{C.RESET}"
          f"{C.DIM}{'Cython/Rust  •  Continuous  •  Human-Readable':^{W-2}}{C.RESET}"
          f"{C.CYAN}║{C.RESET}")
    print(f"{C.CYAN}{'╚' + '═'*(W-2) + '╝'}{C.RESET}")
    print(f"  {C.DIM}Backend : {C.RESET}{C.BOLD}{_backend_name}{C.RESET}")
    print(f"  {C.DIM}Commands: {C.RESET}{C.DIM}help{C.RESET}{C.DIM} — "
          f"{C.RESET}{C.DIM}quit to exit{C.RESET}")
    print()

# ── Multi-line hex reader ─────────────────────────────────────────────────

def _read_continuation() -> str:
    """Read additional hex lines until blank line or complete hex."""
    lines = []
    blank = 0
    try:
        while True:
            try:
                line = input()
            except EOFError:
                break
            s = line.strip()
            if not s:
                blank += 1
                if blank >= 1:
                    break
                continue
            blank = 0
            lines.append(s)
            combined = re.sub(r'\s+','',''.join(lines)).lstrip('0x')
            if combined and re.fullmatch(r'[0-9a-fA-F]+', combined) and len(combined) % 2 == 0:
                break
    except KeyboardInterrupt:
        return ""
    return ' '.join(lines)

# ── REPL commands ─────────────────────────────────────────────────────────

def _cmd_history(session: Session):
    if not session.history:
        print(f"\n  {C.DIM}No analyses yet.{C.RESET}\n")
        return
    print(f"\n  {C.BOLD}Session history ({len(session.history)} analyses):{C.RESET}")
    for i, r in enumerate(session.history):
        rc = risk_colour(r.risk_score)
        print(f"    {C.DIM}{i+1:2d}.{C.RESET}  "
              f"{C.DIM}{r.timestamp}{C.RESET}  "
              f"{r.bytecode_len:,}b  "
              f"{rc}{r.risk_score:3d}/100  {risk_label(r.risk_score)}{C.RESET}  "
              f"{C.DIM}{r.instr_count} instrs  {len(r.functions)} fns{C.RESET}")
    print()


def _cmd_disasm(session: Session):
    r = session.last_result
    if not r:
        print(f"\n  {C.DIM}No analysis loaded.{C.RESET}\n")
        return
    print(section("FULL DISASSEMBLY", C.TEAL))
    print()
    for ins in r.instructions:
        off   = getattr(ins,'offset',0)
        op    = getattr(ins,'opcode',0)
        mn    = getattr(ins,'mnemonic','?')
        imm   = getattr(ins,'imm_hex','') or ''
        cat   = getattr(ins,'category','') or ''
        is_jd = (op == 0x5b)
        col   = cat_col(cat)
        m     = f"{C.GREEN}◆{C.RESET}" if is_jd else " "
        i_str = f" 0x{imm}" if imm else ""
        print(f"  {m} {C.DIM}0x{off:04x}{C.RESET}  "
              f"{C.DIM}{op:02x}{C.RESET}  "
              f"{col}{mn:<14}{C.RESET}"
              f"{C.DIM}{i_str}{C.RESET}")
    print()


def _cmd_source(session: Session):
    r = session.last_result
    if not r:
        print(f"\n  {C.DIM}No analysis loaded.{C.RESET}\n")
        return
    print(f"\n{C.DIM}{'─'*_W}{C.RESET}")
    print(r.pseudo_source or "(no source recovered)")
    print(f"{C.DIM}{'─'*_W}{C.RESET}\n")


def _cmd_security(session: Session):
    r = session.last_result
    if not r:
        print(f"\n  {C.DIM}No analysis loaded.{C.RESET}\n")
        return
    rc = risk_colour(r.risk_score)
    print(f"\n  Risk: {rc}{C.BOLD}{r.risk_score}/100  "
          f"{risk_label(r.risk_score)}{C.RESET}")
    if not r.findings:
        print(f"  {C.GREEN}✔  No findings.{C.RESET}")
    for f in r.findings:
        print(f"  {f}")
    print()


def _cmd_sigs(session: Session):
    r = session.last_result
    if not r:
        print(f"\n  {C.DIM}No analysis loaded.{C.RESET}\n")
        return
    print(f"\n  {C.BOLD}{len(r.functions)} function(s):{C.RESET}")
    for fn in r.functions:
        sel  = getattr(fn,'selector','?')
        name = getattr(fn,'known_name',None) or '???'
        tgt  = getattr(fn,'jump_target',None)
        tgt_s = f"→ 0x{tgt:04x}" if tgt is not None else "→ ?"
        print(f"    {C.CYAN}{sel}{C.RESET}  {C.DIM}{tgt_s}{C.RESET}  {name}")
    print()


def _cmd_file(rest: str, session: Session):
    if not rest:
        print(f"\n  {C.RED}Usage: file <path>{C.RESET}\n")
        return
    try:
        p = Path(rest)
        if not p.exists():
            print(f"\n  {C.RED}✖  Not found: {rest}{C.RESET}\n")
            return
        data = p.read_text().strip() if p.suffix == ".hex" else p.read_bytes()
        print(f"\n  {C.DIM}Loaded {p.stat().st_size:,} bytes from {p}{C.RESET}")
        run_analysis_live(data, session)
    except Exception as e:
        print(f"\n  {C.RED}✖  Error: {e}{C.RESET}\n")

# ── Main REPL loop ────────────────────────────────────────────────────────

def repl(initial_input=None, session: Optional[Session] = None,
         no_loop: bool = False):
    """
    Continuous REPL. Runs until quit.
    Never exits mid-analysis — always delivers results first.
    """
    if session is None:
        session = Session()

    _print_banner()

    if initial_input is not None:
        run_analysis_live(initial_input, session)
        if no_loop:
            return

    while True:
        try:
            print(f"{C.CYAN}hinsdale{C.RESET}{C.DIM}>{C.RESET} ", end="", flush=True)
            raw = input().strip()
        except EOFError:
            print(f"\n{C.DIM}EOF — exiting.{C.RESET}")
            break
        except KeyboardInterrupt:
            print(f"\n  {C.DIM}(Ctrl+C — type quit to exit){C.RESET}")
            continue

        if not raw:
            continue

        cmd  = raw.lower().split()[0]
        rest = raw[len(cmd):].strip()

        if cmd in ("quit","exit","q"):
            print(f"\n  {C.DIM}{len(session.history)} analyses this session.  "
                  f"Goodbye.{C.RESET}\n")
            break

        elif cmd == "help":    print(HELP_TEXT)
        elif cmd == "clear":   os.system("clear" if os.name!="nt" else "cls"); _print_banner()
        elif cmd == "backend": print(f"\n  {C.BOLD}Backend:{C.RESET} {_backend_name}\n")
        elif cmd == "history": _cmd_history(session)
        elif cmd == "disasm":  _cmd_disasm(session)
        elif cmd == "source":  _cmd_source(session)
        elif cmd == "security":_cmd_security(session)
        elif cmd == "sigs":    _cmd_sigs(session)

        elif cmd == "last":
            if not session.last_result:
                print(f"\n  {C.DIM}No previous analysis.{C.RESET}\n")
            else:
                print(render_report(session.last_result))

        elif cmd == "save":
            if not session.last_result:
                print(f"\n  {C.DIM}No analysis to save.{C.RESET}\n")
            else:
                saved = save_report(session.last_result, rest or None)
                print(f"\n  {C.GREEN}✔  Saved: {C.BOLD}{saved}{C.RESET}\n")

        elif cmd == "file":
            _cmd_file(rest, session)

        else:
            # Treat as hex bytecode
            hex_input = raw
            # Check if it looks like incomplete hex — offer continuation
            if sys.stdout.isatty():
                clean_check = re.sub(r'\s+','',hex_input).lstrip('0x')
                if (re.fullmatch(r'[0-9a-fA-F]*', clean_check)
                        and len(clean_check) % 2 != 0):
                    print(f"  {C.DIM}(incomplete hex — paste more, "
                          f"blank line to submit){C.RESET}")
                    more = _read_continuation()
                    if more:
                        hex_input = hex_input + more
            run_analysis_live(hex_input, session)

# ── CLI entry point ───────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="HINSDALE EVM Decompiler — Interactive Shell",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
        Examples:
          python repl_05_shell.py
          python repl_05_shell.py 608060405234801561000f...
          python repl_05_shell.py --file contract.bin
          python repl_05_shell.py --no-repl --file contract.bin
          python repl_05_shell.py --batch a.bin b.bin
          cat contract.hex | python repl_05_shell.py
        """),
    )
    parser.add_argument("bytecode",  nargs="?",       help="Hex bytecode")
    parser.add_argument("--file",    "-f",             help=".bin or .hex file")
    parser.add_argument("--batch",   nargs="+",        help="Batch files")
    parser.add_argument("--no-repl", action="store_true", help="Exit after analysis")
    parser.add_argument("--save",                      help="Save report to file")
    args = parser.parse_args()

    session      = Session()
    initial_data = None

    if args.file:
        p = Path(args.file)
        initial_data = p.read_text().strip() if p.suffix == ".hex" else p.read_bytes()
    elif args.bytecode:
        initial_data = args.bytecode
    elif not sys.stdin.isatty():
        initial_data = sys.stdin.read().strip()

    if args.batch:
        _print_banner()
        for fp in args.batch:
            p = Path(fp)
            print(f"\n  {C.BOLD}Batch: {p.name}{C.RESET}")
            data = p.read_text().strip() if p.suffix == ".hex" else p.read_bytes()
            result = run_analysis_live(data, session)
            if result and args.save:
                base  = Path(args.save)
                fname = base.stem + f"_{p.stem}" + base.suffix
                print(f"  {C.GREEN}✔  Saved: {save_report(result, fname)}{C.RESET}")
        if not args.no_repl:
            repl(session=session)
        return

    try:
        repl(initial_input=initial_data, session=session, no_loop=args.no_repl)
    except Exception as e:
        print(f"\n{C.RED}Fatal: {e}{C.RESET}")
        raise

    if args.save and session.last_result:
        saved = save_report(session.last_result, args.save)
        print(f"  {C.GREEN}✔  Saved: {saved}{C.RESET}")


if __name__ == "__main__":
    main()
