#!/usr/bin/env python3
"""
hinsdale_repl.py — HINSDALE Interactive Decompiler Shell
=========================================================

Runs CONTINUOUSLY — accepts bytecode input in a loop, streams
live progress as each analysis phase completes, then renders
a full human-readable report. Never exits until you type 'quit'.

Usage:
    python hinsdale_repl.py                  # interactive REPL
    python hinsdale_repl.py <hex>            # one-shot then drop to REPL
    python hinsdale_repl.py --file x.bin     # load file then REPL
    python hinsdale_repl.py --batch f1 f2    # batch files then REPL
    echo <hex> | python hinsdale_repl.py     # pipe then REPL
    python hinsdale_repl.py --no-repl <hex>  # one-shot, exit when done

REPL commands:
    <hex>              analyze bytecode
    file <path>        load .bin or .hex file
    last               re-show last report
    save [path]        save last report to file
    history            show session history
    clear              clear screen
    help               show this help
    quit / exit / q    exit
"""

from __future__ import annotations

import os
import sys
import re
import time
import signal
import textwrap
import threading
import itertools
from pathlib import Path
from datetime import datetime
from typing import Optional

try:
    import readline  # enables arrow keys / history in input()
except Exception:
    readline = None

# ── Terminal width ────────────────────────────────────────────────────────

try:
    _W = min(os.get_terminal_size().columns, 100)
except Exception:
    _W = 80

# ── ANSI colours — degrade gracefully if not a tty ───────────────────────

_TTY = sys.stdout.isatty()

class C:
    RESET   = "\033[0m"    if _TTY else ""
    BOLD    = "\033[1m"    if _TTY else ""
    DIM     = "\033[2m"    if _TTY else ""
    RED     = "\033[31m"   if _TTY else ""
    GREEN   = "\033[32m"   if _TTY else ""
    YELLOW  = "\033[33m"   if _TTY else ""
    BLUE    = "\033[34m"   if _TTY else ""
    MAGENTA = "\033[35m"   if _TTY else ""
    CYAN    = "\033[36m"   if _TTY else ""
    WHITE   = "\033[97m"   if _TTY else ""
    BG_DARK = "\033[48;5;235m" if _TTY else ""
    ORANGE  = "\033[38;5;208m" if _TTY else ""
    PURPLE  = "\033[38;5;135m" if _TTY else ""
    TEAL    = "\033[38;5;37m"  if _TTY else ""
    ERASE   = "\r\033[K"   if _TTY else "\r"

# ── Backend loading ────────────────────────────────────────────────────────

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

_backend_name = "unknown"

try:
    import _hinsdale as _cy
    _backend_name = f"Cython/Rust ({_cy.version()})"
    _BACKEND = "cython"
except ImportError:
    _cy = None
    _BACKEND = None

if _BACKEND is None:
    try:
        from hinsdale import Hinsdale as _HinsdaleSubproc
        _sub = _HinsdaleSubproc()
        if _sub._using_rust:
            _backend_name = f"Subprocess/Rust ({_sub.backend})"
            _BACKEND = "subprocess"
        else:
            _backend_name = "Pure Python"
            _BACKEND = "python"
    except ImportError:
        _sub = None
        _backend_name = "Pure Python (basic)"
        _BACKEND = "python"

try:
    import numpy as np
    _NUMPY = True
except ImportError:
    _NUMPY = False

# ── Spinner ────────────────────────────────────────────────────────────────

class Spinner:
    """Animated spinner that runs in a background thread."""
    FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]

    def __init__(self, msg: str, colour: str = C.CYAN):
        self.msg     = msg
        self.colour  = colour
        self._stop   = threading.Event()
        self._thread = threading.Thread(target=self._spin, daemon=True)

    def _spin(self):
        for frame in itertools.cycle(self.FRAMES):
            if self._stop.is_set():
                break
            sys.stdout.write(
                f"{C.ERASE}  {self.colour}{frame}{C.RESET} {C.DIM}{self.msg}…{C.RESET}"
            )
            sys.stdout.flush()
            time.sleep(0.08)

    def __enter__(self):
        if _TTY:
            self._thread.start()
        else:
            print(f"  ▸ {self.msg}…", flush=True)
        return self

    def __exit__(self, *_):
        self._stop.set()
        if _TTY and self._thread.is_alive():
            self._thread.join(timeout=0.3)
        if _TTY:
            sys.stdout.write(C.ERASE)
            sys.stdout.flush()

    def update(self, msg: str):
        self.msg = msg

# ── Progress bar ──────────────────────────────────────────────────────────

def progress_bar(label: str, frac: float, width: int = 30, colour: str = C.GREEN) -> str:
    filled = int(frac * width)
    bar    = "█" * filled + "░" * (width - filled)
    pct    = int(frac * 100)
    return f"  {C.DIM}{label:<20}{C.RESET} {colour}{bar}{C.RESET} {pct:3d}%"

# ── Drawing helpers ────────────────────────────────────────────────────────

def rule(char: str = "─", colour: str = C.DIM, width: int = _W) -> str:
    return f"{colour}{char * width}{C.RESET}"

def header(title: str, colour: str = C.CYAN, width: int = _W) -> str:
    pad   = max(0, width - len(title) - 4)
    left  = pad // 2
    right = pad - left
    return (
        f"\n{colour}{'═' * width}{C.RESET}\n"
        f"{colour}║{C.RESET}{' ' * left}{C.BOLD}{C.WHITE}{title}{C.RESET}{' ' * right}{colour}║{C.RESET}\n"
        f"{colour}{'═' * width}{C.RESET}"
    )

def section(title: str, colour: str = C.BLUE) -> str:
    bar = "─" * max(0, _W - len(title) - 3)
    return f"\n{colour}── {C.BOLD}{title}{C.RESET}{colour} {bar}{C.RESET}"

def badge(text: str, colour: str) -> str:
    return f"{colour}[{text}]{C.RESET}"

def indent(text: str, spaces: int = 4) -> str:
    return textwrap.indent(text, " " * spaces)

# ── Risk colour ────────────────────────────────────────────────────────────

def risk_colour(score: int) -> str:
    if score >= 60: return C.RED
    if score >= 30: return C.ORANGE
    if score >= 10: return C.YELLOW
    return C.GREEN

def risk_label(score: int) -> str:
    if score >= 60: return "CRITICAL"
    if score >= 30: return "HIGH"
    if score >= 10: return "MEDIUM"
    if score > 0:   return "LOW"
    return "CLEAN"

def severity_colour(sev: str) -> str:
    s = sev.upper()
    if "CRITICAL" in s: return C.RED
    if "HIGH"     in s: return C.ORANGE
    if "MEDIUM"   in s: return C.YELLOW
    if "LOW"      in s: return C.CYAN
    return C.DIM

# ── Hex display helper ─────────────────────────────────────────────────────

def hex_dump(data: bytes, cols: int = 16, max_rows: int = 4) -> str:
    """Classic hex dump for bytecode preview."""
    lines = []
    for row in range(min(max_rows, (len(data) + cols - 1) // cols)):
        off   = row * cols
        chunk = data[off:off + cols]
        hex_  = " ".join(f"{b:02x}" for b in chunk)
        ascii_= "".join(chr(b) if 32 <= b < 127 else "·" for b in chunk)
        lines.append(
            f"  {C.DIM}{off:04x}{C.RESET}  {C.CYAN}{hex_:<{cols*3}}{C.RESET}  "
            f"{C.DIM}{ascii_}{C.RESET}"
        )
    if len(data) > max_rows * cols:
        lines.append(f"  {C.DIM}... ({len(data)} bytes total){C.RESET}")
    return "\n".join(lines)

# ── Opcode category colours ────────────────────────────────────────────────

_CAT_COLOUR = {
    "ARITHMETIC": C.YELLOW,
    "COMPARISON": C.CYAN,
    "BITWISE":    C.PURPLE,
    "STACK":      C.TEAL,
    "MEMORY":     C.BLUE,
    "STORAGE":    C.ORANGE,
    "FLOW":       C.GREEN,
    "SYSTEM":     C.RED,
    "LOG":        C.MAGENTA,
    "HASH":       C.PURPLE,
    "ENVIRONMENT":C.CYAN,
    "BLOCK":      C.TEAL,
    "INVALID":    C.RED,
    "STOP":       C.RED,
}

def cat_col(cat: str) -> str:
    return _CAT_COLOUR.get(cat.upper(), C.DIM)
