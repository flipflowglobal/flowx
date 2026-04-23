#!/usr/bin/env python3
"""
hinsdale_cy.py — High-performance Python interface to Hinsdale
==============================================================

Uses the Cython extension (_hinsdale) when compiled.
Falls back to the subprocess-based hinsdale.py automatically.

Speed tiers:
  1. Cython  — direct C FFI, GIL released, ~0.1–0.5ms overhead
  2. Subprocess JSON — ~2–5ms overhead per call
  3. Pure Python — disasm-only fallback

Usage:
    from hinsdale_cy import analyze, HinsdaleReport

    r = analyze("608060405234801561000f...")
    print(r.summary())           # one-liner stats
    print(r.pseudo_source)       # decompiled Solidity
    print(r.risk_score)          # 0-100
    arr = r.instructions_numpy() # numpy structured array — instant
    for fn in r.functions:       # list of FunctionSig
        print(fn.selector, fn.known_name)
"""

from __future__ import annotations
import os
import sys
import json
import time
from pathlib import Path
from typing import Optional, List

# ── Try importing Cython extension ─────────────────────────────────────────

_CYTHON_AVAILABLE = False
_CyCtx = None

try:
    import _hinsdale as _cy
    _CYTHON_AVAILABLE = True
    _CyCtx = _cy.HinsdaleContext
except ImportError:
    pass

# ── Numpy (optional — used for bulk instruction arrays) ───────────────────

try:
    import numpy as np
    _NUMPY = True
except ImportError:
    _NUMPY = False

# ── Fallback: subprocess wrapper from hinsdale.py ─────────────────────────

_HERE = Path(__file__).parent
sys.path.insert(0, str(_HERE / "python"))
try:
    from hinsdale import Hinsdale as _SubprocHinsdale, HinsdaleReport as _SubprocReport
    _SUBPROCESS = True
except ImportError:
    _SUBPROCESS = False


# ══════════════════════════════════════════════════════════════════════════════
# Unified report — wraps either Cython ctx or subprocess report
# ══════════════════════════════════════════════════════════════════════════════

class HinsdaleReport:
    """
    Unified report object. Works regardless of which backend produced it.

    Properties
    ----------
    pseudo_source : str        — decompiled pseudo-Solidity
    risk_score    : int        — 0-100
    functions     : list       — FunctionSig objects
    findings      : list       — Finding objects
    elapsed_ms    : float      — analysis time

    Methods
    -------
    summary()              → str one-liner
    instructions()         → list of Instruction objects
    instructions_numpy()   → np.ndarray (Cython only, else list)
    jumpdests()            → list of int offsets
    json()                 → str JSON report
    """

    def __init__(self, backend, raw=None):
        self._backend = backend   # Cython ctx OR subprocess report
        self._raw     = raw       # raw JSON dict if subprocess
        self._is_cy   = _CYTHON_AVAILABLE and isinstance(backend, _cy.HinsdaleContext)

    # ── Core properties ───────────────────────────────────────────────────

    @property
    def pseudo_source(self) -> str:
        if self._is_cy:
            return self._backend.pseudo_source()
        return self._backend.pseudo_source

    @property
    def risk_score(self) -> int:
        if self._is_cy:
            return self._backend.risk_score()
        return self._backend.risk_score

    @property
    def elapsed_ms(self) -> float:
        if self._is_cy:
            return self._backend.elapsed_ms()
        return self._backend.elapsed_ms

    @property
    def functions(self):
        if self._is_cy:
            return self._backend.functions()
        return self._backend.functions

    @property
    def findings(self):
        if self._is_cy:
            return self._backend.findings()
        return self._backend.findings

    # ── Instructions ─────────────────────────────────────────────────────

    def instructions(self):
        """Return list of Instruction objects."""
        if self._is_cy:
            return self._backend.instructions()
        return self._backend.disassembly.instructions

    def instructions_numpy(self):
        """
        Return instructions as numpy structured array.
        Cython: single bulk C→numpy copy (fastest).
        Fallback: builds array from Python list.
        """
        if self._is_cy:
            return self._backend.instructions_numpy()

        if not _NUMPY:
            raise ImportError("numpy not installed")

        instrs = self.instructions()
        dtype = [
            ('offset',   'u4'), ('opcode', 'u1'),
            ('imm_len',  'u1'), ('stack_in', 'u1'), ('stack_out', 'u1'),
            ('mnemonic', 'S16'), ('category', 'S16'),
            ('imm_hex',  'S68'), ('imm_u64', 'u8'), ('has_imm_u64', 'u1'),
        ]
        arr = np.zeros(len(instrs), dtype=dtype)
        for i, ins in enumerate(instrs):
            arr[i]['offset']   = ins.offset
            arr[i]['opcode']   = ins.opcode
            arr[i]['mnemonic'] = ins.mnemonic.encode()[:15]
            arr[i]['category'] = ins.category.encode()[:15]
            if ins.imm:
                arr[i]['imm_hex'] = ins.imm.encode()[:67]
                arr[i]['imm_len'] = len(ins.imm) // 2
            if ins.imm_u256 is not None:
                arr[i]['imm_u64']     = ins.imm_u256
                arr[i]['has_imm_u64'] = 1
        return arr

    def jumpdests(self) -> list:
        if self._is_cy:
            return self._backend.jumpdests()
        return self._backend.disassembly.jumpdests

    def json(self) -> str:
        if self._is_cy:
            return self._backend.json()
        return json.dumps(self._raw or {})

    # ── Summary ───────────────────────────────────────────────────────────

    def summary(self) -> str:
        if self._is_cy:
            return self._backend.summary().one_liner()
        return self._backend.summary()

    def __repr__(self):
        return f"<HinsdaleReport backend={'cython' if self._is_cy else 'subprocess'} risk={self.risk_score} {self.elapsed_ms:.1f}ms>"

    # ── Context manager support ───────────────────────────────────────────

    def __enter__(self):
        return self

    def __exit__(self, *args):
        if self._is_cy and self._backend is not None:
            self._backend.__exit__(*args)


# ══════════════════════════════════════════════════════════════════════════════
# Main interface
# ══════════════════════════════════════════════════════════════════════════════

class HinsdaleEngine:
    """
    High-performance Hinsdale engine.

    Automatically uses the fastest available backend:
      Cython > Subprocess > Pure Python

    >>> engine = HinsdaleEngine()
    >>> print(engine.backend_name)
    >>> r = engine.analyze("6080604052...")
    >>> print(r.summary())
    >>> arr = r.instructions_numpy()   # numpy array — 0 Python overhead per instruction
    """

    def __init__(self):
        if _CYTHON_AVAILABLE:
            self._mode = "cython"
        elif _SUBPROCESS:
            self._mode = "subprocess"
            self._sub  = _SubprocHinsdale()
        else:
            self._mode = "python_fallback"

    @property
    def backend_name(self) -> str:
        if self._mode == "cython":
            return f"Cython/Rust FFI (libhinsdale) — {_cy.version()}"
        if self._mode == "subprocess":
            return f"Subprocess JSON — {self._sub.backend}"
        return "Pure Python fallback"

    def analyze(self, bytecode) -> HinsdaleReport:
        """
        Analyze EVM bytecode.

        Parameters
        ----------
        bytecode : str | bytes | bytearray
            Hex string or raw bytes.

        Returns
        -------
        HinsdaleReport
        """
        if self._mode == "cython":
            ctx = _cy.analyze(bytecode)
            return HinsdaleReport(ctx)

        if self._mode == "subprocess":
            raw_report = self._sub.analyze(bytecode)
            return HinsdaleReport(raw_report, raw=raw_report.raw)

        # Pure Python disasm fallback
        from hinsdale import _py_fallback
        if isinstance(bytecode, str):
            bytecode = bytes.fromhex(bytecode.strip().removeprefix("0x"))
        raw_report = _py_fallback(bytecode)
        return HinsdaleReport(raw_report)

    def batch_analyze(self, bytecodes: list) -> list:
        """
        Analyze multiple bytecodes.
        Cython backend: runs without holding GIL between analyses.

        Returns
        -------
        list of HinsdaleReport
        """
        return [self.analyze(b) for b in bytecodes]

    def disasm_numpy(self, bytecode) -> "np.ndarray":
        """Fastest disassembly — returns numpy structured array directly."""
        return self.analyze(bytecode).instructions_numpy()

    def risk_score(self, bytecode) -> int:
        """Single-call risk score."""
        return self.analyze(bytecode).risk_score

    def pseudo_source(self, bytecode) -> str:
        """Single-call pseudo-Solidity decompilation."""
        return self.analyze(bytecode).pseudo_source

    def functions(self, bytecode) -> list:
        """Single-call function signature recovery."""
        return self.analyze(bytecode).functions

    def findings(self, bytecode) -> list:
        """Single-call security findings."""
        return self.analyze(bytecode).findings


# ── Module-level singleton + convenience functions ─────────────────────────

_engine: Optional[HinsdaleEngine] = None

def _get_engine() -> HinsdaleEngine:
    global _engine
    if _engine is None:
        _engine = HinsdaleEngine()
    return _engine


def analyze(bytecode) -> HinsdaleReport:
    """Module-level analyze — uses global HinsdaleEngine singleton."""
    return _get_engine().analyze(bytecode)


def backend_name() -> str:
    """Which backend is active."""
    return _get_engine().backend_name


# ── CLI ───────────────────────────────────────────────────────────────────

def _cli():
    import argparse

    parser = argparse.ArgumentParser(description="Hinsdale EVM Decompiler (Cython/Rust)")
    parser.add_argument("bytecode", nargs="?", help="Hex bytecode")
    parser.add_argument("--file",          help="Binary .bin file")
    parser.add_argument("--hex-file",      help="Hex text file")
    parser.add_argument("--json",          action="store_true")
    parser.add_argument("--summary",       action="store_true")
    parser.add_argument("--sigs-only",     action="store_true")
    parser.add_argument("--security-only", action="store_true")
    parser.add_argument("--disasm-only",   action="store_true")
    parser.add_argument("--numpy",         action="store_true", help="Print numpy array info")
    args = parser.parse_args()

    engine = HinsdaleEngine()
    print(f"[HINSDALE] Backend: {engine.backend_name}", file=sys.stderr)

    if args.file:
        report = engine.analyze(Path(args.file).read_bytes())
    elif args.hex_file:
        report = engine.analyze(Path(args.hex_file).read_text().strip())
    elif args.bytecode:
        report = engine.analyze(args.bytecode)
    else:
        import sys as _sys
        data = _sys.stdin.read().strip()
        if not data:
            parser.print_help()
            return
        report = engine.analyze(data)

    if args.json:
        print(report.json())
        return

    if args.summary:
        print(report.summary())
        return

    if args.numpy and _NUMPY:
        arr = report.instructions_numpy()
        print(f"numpy array shape: {arr.shape}  dtype: {arr.dtype}")
        print(f"opcode counts: {dict(zip(*np.unique(arr['opcode'], return_counts=True)))}")
        return

    print()
    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║         HINSDALE EVM DECOMPILER — CYTHON ACCELERATED            ║")
    print("╚══════════════════════════════════════════════════════════════════╝")
    print()
    print(report.summary())
    print()

    if args.disasm_only:
        for ins in report.instructions():
            print(f"  {ins}")
        return

    if not args.security_only:
        print("── FUNCTION SIGNATURES ──────────────────────────────────────────")
        fns = report.functions
        if not fns:
            print("  (none)")
        for fn in fns:
            nm = getattr(fn, 'known_name', None) or "???"
            tgt = f"→ 0x{fn.jump_target:04x}" if getattr(fn, 'jump_target', None) else "→ ?"
            print(f"  {fn.selector}  {tgt}  {nm}")
        print()
        if args.sigs_only:
            return

    print("── SECURITY ─────────────────────────────────────────────────────")
    for f in report.findings:
        print(f"  {f}")
    print()

    if args.security_only:
        return

    print("── PSEUDO-SOLIDITY ──────────────────────────────────────────────")
    print(report.pseudo_source)


if __name__ == "__main__":
    _cli()
