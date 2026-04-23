# HINSDALE EVM DECOMPILER
**Rust core • Python FFI • Termux aarch64 optimized**

Built from the Aureon compiler stack — deciphers EVM bytecode at extreme length and difficulty.

---

## Architecture

```
bytecode (hex / bytes)
      │
      ▼
 ┌─────────────────────────────────────────────────────┐
 │              RUST CORE (hinsdale-cli)               │
 │                                                     │
 │  opcodes.rs  ──  complete EVM table (Cancun)        │
 │  disasm.rs   ──  linear sweep + JUMPDEST map        │
 │  cfg.rs      ──  basic block CFG + edge resolution  │
 │  signatures.rs── dispatcher pattern → selectors     │
 │  security.rs ──  reentrancy / selfdestruct / etc    │
 │  decompiler.rs── symbolic stack → pseudo-Solidity   │
 │  lib.rs      ──  full pipeline + JSON output        │
 └─────────────────────────────────────────────────────┘
      │  JSON (subprocess pipe)
      ▼
 ┌─────────────────────────────────────────────────────┐
 │          PYTHON WRAPPER (hinsdale.py)               │
 │                                                     │
 │  HinsdaleReport dataclass with convenience props   │
 │  Pure-Python fallback (disasm + basic sigs)         │
 │  CLI with --json / --disasm-only / --sigs-only      │
 └─────────────────────────────────────────────────────┘
```

---

## Termux Install (one command)

```bash
# Clone or copy hinsdale/ to Termux
cd ~/hinsdale
bash install_hinsdale.sh
```

The script:
1. `pkg install rust python` (if not present)
2. `cargo build --release` with aarch64 flags
3. Copies `hinsdale-cli` binary to Termux PATH
4. Installs Python wrapper as `hinsdale` CLI

### Manual build (if you prefer)

```bash
# In Termux
pkg install rust python python-pip

cd ~/hinsdale
export ANDROID_API_LEVEL=24
cargo build --release --bin hinsdale-cli

# Test
./target/release/hinsdale-cli --summary 6080604052...
```

---

## CLI Usage

```bash
# Full report
hinsdale-cli <hex_bytecode>

# JSON output (pipe to jq)
hinsdale-cli --json <hex> | jq .security.risk_score

# Disassembly only (fastest — no CFG overhead)
hinsdale-cli --disasm-only <hex>

# Function signatures only
hinsdale-cli --sigs-only <hex>

# Security audit only
hinsdale-cli --security-only <hex>

# One-liner summary
hinsdale-cli --summary <hex>

# From file
hinsdale-cli --file contract.bin
hinsdale-cli --hex-file contract.hex

# From stdin
cat bytecode.hex | hinsdale-cli
xxd -p contract.bin | tr -d '\n' | hinsdale-cli
```

---

## Python Usage

```python
from hinsdale import Hinsdale

h = Hinsdale()

# Analyze hex bytecode
r = h.analyze("608060405234801561000f...")

# Summary line
print(r.summary())
# HINSDALE │ 2422 bytes │ 489 instrs │ 67 blocks │ 4 fns │ 2 findings │ risk=18 │ 3.1ms

# Pseudo-Solidity source
print(r.pseudo_source)

# Function signatures
for fn in r.functions:
    print(fn.selector, fn.known_name)
# 0x839006f2  flash(address,uint256)
# 0x1b11d0ff  executeOperation(address,uint256,uint256,address,bytes)

# Security findings
for f in r.findings:
    print(f.severity, f.title)

# Risk score
print(r.risk_score)  # 0-100

# Raw disassembly
for ins in r.disassembly.instructions[:10]:
    print(ins)

# Analyze from file
r = h.analyze_file("contract.bin")
r = h.analyze_file("contract.hex")
```

---

## What Hinsdale Detects

### Opcodes
- Complete EVM coverage: Frontier → Cancun (EIP-4844, EIP-3855, EIP-1153, EIP-5656)
- All PUSH1–PUSH32, DUP1–DUP16, SWAP1–SWAP16
- EOF EIP-3540 RJUMP/RJUMPI placeholders

### Function Signatures
- Dispatcher pattern: `PUSH4 selector → EQ → JUMPI`
- 60+ built-in 4-byte selectors (ERC-20, ERC-721, Aave V3, Uniswap V3, Ownable)
- Event topic recovery from `PUSH32 → LOG` patterns
- Jump target resolution

### Security Analysis
- Reentrancy: SSTORE after CALL without prior SSTORE (violates CEI)
- Unchecked CALL return (POP after CALL)
- SELFDESTRUCT with/without access control
- DELEGATECALL with calldata-derived address (arbitrary code exec)
- tx.origin used for authentication
- Block timestamp dependency
- Hardcoded addresses
- Proxy detection

### Decompiler
- Symbolic stack simulation per basic block
- Reconstructs: if/goto, storage reads/writes, CALL/DELEGATECALL, LOG, arithmetic
- Storage slot map (slot number → read/write accesses)
- Pseudo-Solidity output

---

## Performance

On Termux aarch64 (Snapdragon):
- 10KB bytecode: ~2–5ms
- 100KB bytecode: ~15–40ms  
- 1MB bytecode: ~150–400ms

The Rust binary runs in a single linear pass for disassembly (O(n) in bytecode size). CFG and decompilation are O(n·k) where k is average block size.

---

## Integration with Aureon

```python
# Drop into aureon project
from compiler import CONTRACTS
from hinsdale import Hinsdale

h = Hinsdale()

# Decompile the embedded bytecode from compiler.py
bytecode = "608060405234801561000f575f80fd..."  # from _SEPOLIA_BYTECODE
r = h.analyze(bytecode)

print(r.summary())
for fn in r.functions:
    print(fn.selector, "→", fn.known_name)
```

---

## Files

```
hinsdale/
├── Cargo.toml                    # Rust project
├── install_hinsdale.sh           # One-shot Termux installer
├── src/
│   ├── lib.rs                    # Public API + pipeline
│   ├── main.rs                   # CLI binary
│   ├── opcodes.rs                # Complete EVM opcode table
│   ├── disasm.rs                 # Linear sweep disassembler
│   ├── cfg.rs                    # Control-flow graph builder
│   ├── signatures.rs             # Function selector recovery
│   ├── security.rs               # Security pattern analyzer
│   └── decompiler.rs             # Symbolic decompiler
├── python/
│   └── hinsdale.py               # Python wrapper + CLI + fallback
└── tests/
    └── test_aureon.py            # Integration test (real Aureon bytecode)
```
