#!/usr/bin/env bash
# build.sh — Build Hinsdale v2.0 (Rust core + Cython extension)
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

PROFILE="${1:-release}"
HERE="$(cd "$(dirname "$0")" && pwd)"

info "Building Hinsdale v2.0 — profile: $PROFILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Rust core ──────────────────────────────────────────────────────────
info "Building Rust core..."
cd "$HERE"
if [[ "$PROFILE" == "release" ]]; then
    cargo build --release 2>&1 | tail -5
else
    cargo build 2>&1 | tail -5
fi

TARGET_DIR="$HERE/target/$PROFILE"
LIB="$TARGET_DIR/libhinsdale.so"
[[ -f "$LIB" ]] || error "Build failed: $LIB not found"
info "Rust build complete → $LIB"

# ── 2. Cython extension ───────────────────────────────────────────────────
if command -v cython3 &>/dev/null || command -v cython &>/dev/null; then
    info "Building Cython extension..."
    CYTHON_CMD=$(command -v cython3 2>/dev/null || command -v cython)
    $CYTHON_CMD --version 2>&1 | head -1

    $CYTHON_CMD cython/_hinsdale.pyx -o cython/_hinsdale.c \
        --include-dir=cython/ \
        -X language_level=3 \
        -X boundscheck=False \
        -X wraparound=False 2>&1

    PYTHON="${PYTHON:-python3}"
    INCLUDES=$($PYTHON -c "import numpy; print(numpy.get_include())" 2>/dev/null || echo "")
    PY_INCLUDE=$($PYTHON -c "import sysconfig; print(sysconfig.get_path('include'))")
    PY_SUFFIX=$($PYTHON -c "import sysconfig; print(sysconfig.get_config_var('EXT_SUFFIX'))")

    gcc -O3 -march=native -ffast-math -shared -fPIC \
        -I"cython/" \
        -I"$PY_INCLUDE" \
        ${INCLUDES:+-I"$INCLUDES"} \
        -L"$TARGET_DIR" \
        cython/_hinsdale.c \
        -o "_hinsdale${PY_SUFFIX}" \
        -lhinsdale \
        -Wl,-rpath,"$TARGET_DIR" 2>&1

    info "Cython extension built → _hinsdale${PY_SUFFIX}"
else
    warn "Cython not found — skipping Python extension"
    warn "Install: pip install cython numpy"
fi

# ── 3. Smoke test ─────────────────────────────────────────────────────────
if [[ -f "$TARGET_DIR/hinsdale-cli" ]]; then
    info "Smoke test..."
    echo "00" | "$TARGET_DIR/hinsdale-cli" --summary || warn "CLI smoke test failed"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Build complete!"
echo ""
echo "  CLI:     $TARGET_DIR/hinsdale-cli"
echo "  Library: $LIB"
echo ""
echo "  Usage examples:"
echo "    hinsdale-cli <hex> --summary"
echo "    hinsdale-cli <hex> --json"
echo "    python3 -c \"import _hinsdale; print(_hinsdale.version())\""
