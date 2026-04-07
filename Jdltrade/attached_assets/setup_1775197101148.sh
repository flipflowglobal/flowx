#!/bin/bash
# ============================================================
# NEXUS-ARB v2 — Automated Installer
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[NEXUS]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN] ${NC} $*"; }
fail() { echo -e "${RED}[FAIL] ${NC} $*"; exit 1; }

NEXUS_VERSION="2.0.0"
MIN_PYTHON_MINOR=10
MIN_NODE=18

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   NEXUS-ARB v${NEXUS_VERSION} — Installer        ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""

# ── Architecture ──────────────────────────────────────────────────────────────
ARCH=$(uname -m)
log "Architecture: $ARCH"

# ── Python 3.10+ ──────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    fail "Python3 not found. Install: sudo apt-get install python3"
fi
PYVER=$(python3 -c "import sys; print(sys.version_info.minor)")
if [ "$PYVER" -lt "$MIN_PYTHON_MINOR" ]; then
    fail "Python 3.${MIN_PYTHON_MINOR}+ required. Found: $(python3 --version)"
fi
log "Python: $(python3 --version)"

# ── System packages ───────────────────────────────────────────────────────────
if command -v apt-get &>/dev/null; then
    log "Installing system packages…"
    sudo apt-get update -qq 2>/dev/null || true
    sudo apt-get install -y -qq python3-venv python3-pip build-essential git curl 2>/dev/null || true
fi

# ── Node.js 18+ ───────────────────────────────────────────────────────────────
NODE_VER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
if [ "$NODE_VER" -lt "$MIN_NODE" ]; then
    warn "Node.js ${MIN_NODE}+ required. Installing via nvm…"
    if [ ! -d "$HOME/.nvm" ]; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    fi
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install $MIN_NODE && nvm use $MIN_NODE
fi
log "Node.js: $(node --version)"

# ── Python virtual environment ────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
    log "Creating virtual environment…"
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip wheel --quiet
log "Virtual environment: .venv"

# ── Python dependencies ───────────────────────────────────────────────────────
log "Installing Python dependencies (may take 2-5 min on ARM)…"
pip install -r requirements.txt --quiet \
    || fail "pip install failed. Check requirements.txt and internet connection."
log "Python dependencies installed."

# ── Node.js / Hardhat ─────────────────────────────────────────────────────────
log "Installing Hardhat…"
npm install --silent 2>/dev/null \
    || fail "npm install failed."
log "Hardhat installed."

# ── Compile Solidity ──────────────────────────────────────────────────────────
log "Compiling Solidity contracts…"
npx hardhat compile 2>&1 | tail -5 \
    || fail "Solidity compilation failed. Check contracts/ for errors."
log "Contracts compiled."

# ── Environment file ──────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
    cp .env.example .env
    warn "Created .env from .env.example"
    warn "⚠  EDIT .env BEFORE RUNNING: fill in ETH_RPC_URL and DEPLOYER_PRIVATE_KEY"
else
    log ".env exists — skipping."
fi

# ── Database ──────────────────────────────────────────────────────────────────
log "Initializing database…"
source .venv/bin/activate
python3 -c "
import asyncio, sys
sys.path.insert(0,'.')
from database.db_manager import DatabaseManager
asyncio.run(DatabaseManager().initialize())
print('Database OK')
" || fail "Database initialization failed."

# ── Init files ────────────────────────────────────────────────────────────────
for pkg in core scanner executor ai api engine database tests; do
    touch "${pkg}/__init__.py" 2>/dev/null || true
done

# ── Unit tests ────────────────────────────────────────────────────────────────
log "Running unit tests (no fork required)…"
python3 -m pytest tests/ -k "not fork" -q --tb=short 2>&1 \
    || warn "Some tests failed — review above before deploying to mainnet."

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   NEXUS-ARB v${NEXUS_VERSION} SETUP COMPLETE            ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Next steps:                                  ║${NC}"
echo -e "${GREEN}║  1. Edit .env  — add RPC URL + private key    ║${NC}"
echo -e "${GREEN}║  2. npm run deploy:mainnet                    ║${NC}"
echo -e "${GREEN}║  3. Set FLASH_RECEIVER_ADDRESS in .env        ║${NC}"
echo -e "${GREEN}║  4. ./start.sh  (or: python3 main.py)         ║${NC}"
echo -e "${GREEN}║  5. Dashboard → http://localhost:8420         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""
