# repl_04_session.py — Session, live runner, save_report
# Part 4 of hinsdale_repl
# Depends on: repl_01_core, repl_02_analysis, repl_03_renderer

from __future__ import annotations
import os, re, sys, time, threading
from pathlib import Path
from datetime import datetime
from typing import Optional
import json as _json

try:
    from .repl_01_core import C, _W, _backend_name, risk_colour, risk_label, section, progress_bar
    from .repl_02_analysis import AnalysisResult, _do_analysis
    from .repl_03_renderer import render_report
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

    C = _core.C
    _W = _core._W
    _backend_name = _core._backend_name
    risk_colour = _core.risk_colour
    risk_label = _core.risk_label
    section = _core.section
    progress_bar = _core.progress_bar
    AnalysisResult = _analysis.AnalysisResult
    _do_analysis = _analysis._do_analysis
    render_report = _renderer.render_report

# ── Session ────────────────────────────────────────────────────────────────

class Session:
    def __init__(self):
        self.history:     list[AnalysisResult] = []
        self.last_result: Optional[AnalysisResult] = None

    def add(self, r: AnalysisResult):
        self.history.append(r)
        self.last_result = r

# ── Live analysis with streaming progress ─────────────────────────────────

def run_analysis_live(bytecode_input, session: Session) -> Optional[AnalysisResult]:
    """
    Run analysis in a background thread with live phase progress.
    Blocks main thread until done — Ctrl+C waits for result (never aborts).
    """
    # Quick input validation
    if isinstance(bytecode_input, str):
        clean = bytecode_input.strip().lstrip('0x').lstrip('0X')
        clean = re.sub(r'\s+', '', clean)
        if not clean:
            print(f"\n  {C.RED}✖  Empty input.{C.RESET}\n")
            return None
        if not re.fullmatch(r'[0-9a-fA-F]+', clean):
            bad = re.search(r'[^0-9a-fA-F]', clean)
            print(f"\n  {C.RED}✖  Invalid character '{bad.group()}'"
                  f" at position {bad.start()}.{C.RESET}\n")
            return None
        if len(clean) % 2 != 0:
            print(f"\n  {C.RED}✖  Odd hex length ({len(clean)} chars).{C.RESET}\n")
            return None
        size = len(clean) // 2
    else:
        size = len(bytecode_input)

    print()
    print(f"  {C.CYAN}{'─' * (_W-4)}{C.RESET}")
    print(f"  {C.BOLD}Analyzing {size:,} bytes of EVM bytecode…{C.RESET}")
    print(f"  {C.CYAN}{'─' * (_W-4)}{C.RESET}")
    print()

    current_phase = ["Initializing"]
    result_holder = [None]
    done_event    = threading.Event()
    _TTY          = sys.stdout.isatty()

    def on_phase(name, frac):
        current_phase[0] = name
        bar = progress_bar(name, frac)
        if _TTY:
            sys.stdout.write(f"{C.ERASE}{bar}")
            sys.stdout.flush()
        else:
            print(f"  ▸ {name}  ({int(frac*100)}%)", flush=True)

    def worker():
        try:
            result_holder[0] = _do_analysis(bytecode_input, on_phase=on_phase)
        except Exception as e:
            r = AnalysisResult()
            r.pseudo_source = f"[FATAL] {e}"
            result_holder[0] = r
        finally:
            done_event.set()

    t = threading.Thread(target=worker, daemon=False)
    t.start()

    start = time.perf_counter()
    try:
        while not done_event.is_set():
            elapsed = time.perf_counter() - start
            if _TTY:
                sys.stdout.write(
                    f"{C.ERASE}  {C.CYAN}⠿{C.RESET} "
                    f"{C.DIM}{current_phase[0]}  ({elapsed:.1f}s){C.RESET}"
                )
                sys.stdout.flush()
            done_event.wait(timeout=0.15)
    except KeyboardInterrupt:
        print(f"\n\n  {C.YELLOW}⚠  Ctrl+C — waiting for result…{C.RESET}")
        done_event.wait()

    t.join()

    if _TTY:
        sys.stdout.write(C.ERASE)
        sys.stdout.flush()

    result = result_holder[0]
    if result is None:
        print(f"  {C.RED}✖  No result returned.{C.RESET}\n")
        return None

    print(render_report(result))
    session.add(result)
    return result

# ── Save report ────────────────────────────────────────────────────────────

def save_report(result: AnalysisResult, path: Optional[str] = None) -> str:
    """Save ANSI-stripped report + JSON summary to file."""
    if path is None:
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = f"hinsdale_report_{ts}.txt"

    ansi_re = re.compile(r'\033\[[0-9;]*m')
    clean   = ansi_re.sub('', render_report(result))

    clean += f"\n\n{'='*80}\nRAW PSEUDO-SOURCE\n{'='*80}\n"
    clean += result.pseudo_source or "(none)"
    clean += f"\n\n{'='*80}\nJSON SUMMARY\n{'='*80}\n"

    summary_dict = {
        "timestamp":       result.timestamp,
        "bytecode_len":    result.bytecode_len,
        "elapsed_ms":      result.elapsed_ms,
        "risk_score":      result.risk_score,
        "risk_label":      risk_label(result.risk_score),
        "instr_count":     result.instr_count,
        "block_count":     result.block_count,
        "is_runtime":      result.is_runtime,
        "is_proxy":        result.is_proxy,
        "is_erc20":        result.is_erc20,
        "has_selfdestruct":result.has_selfdestruct,
        "has_delegatecall":result.has_delegatecall,
        "functions": [
            {
                "selector":    getattr(f,'selector','?'),
                "name":        getattr(f,'known_name',None) or '???',
                "jump_target": getattr(f,'jump_target',None),
                "is_view":     getattr(f,'is_view',False),
            }
            for f in result.functions
        ],
        "findings": [
            {
                "severity":    getattr(f,'severity','?'),
                "title":       getattr(f,'title','?'),
                "description": getattr(f,'description',''),
                "offset":      getattr(f,'offset',None),
            }
            for f in result.findings
        ],
        "top_opcodes": result.opcode_freq,
    }
    clean += _json.dumps(summary_dict, indent=2)
    Path(path).write_text(clean)
    return path
