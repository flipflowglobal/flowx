#!/usr/bin/env python3
"""
28_tests_test_aureon.py.txt — Integration test using real Aureon bytecode

Run from repository root:
    python 28_tests_test_aureon.py.txt
    python 28_tests_test_aureon.py.txt --full
"""
try:
    from hinsdale import Hinsdale
except ImportError as exc:
    raise ImportError(
        "Unable to import 'hinsdale' using normal package imports. "
        "Place this test in the project's test suite (for example, "
        "'tests/test_aureon.py') and run it with the package installed "
        "or otherwise available on the standard Python import path."
    ) from exc
# ── Real Aureon FlashLoanArbitrage runtime bytecode from compiler.py ──────
AUREON_HEX = (
    "608060405234801561000f575f80fd5b506004361061006f575f3560e01c8063839006f21161004d578063839006f2146100f5"
    "5780638da5cb5b14610108578063da2ca9b514610127575f80fd5b80630b187dd3146100735780631b11d0ff14610088"
    "5780632301d775146100b0575b5f80fd5b6100866100813660046107cb565b61013a565b005b61009b61009636600461"
    "07f3565b6102c2565b60405190151581526020015b60405180910390f35b6001546100d09073ffffffffffffffffffff"
    "ffffffffffffffffffff1681565b60405173ffffffffffffffffffffffffffffffffffffffff90911681526020016100"
    "a7565b610086610103366004610891565b610526565b5f546100d09073ffffffffffffffffffffffffffffffffffffff"
    "ff1681565b610086610135366004610891565b6106dc565b5f5473ffffffffffffffffffffffffffffffffffffffff16"
    "33146101bf576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004"
    "820152600960248201527f4e6f74206f776e657200000000000000000000000000000000000000000000006044820152"
    "6064015b60405180910390fd5b6040517f42b0b77c000000000000000000000000000000000000000000000000000000"
    "00815230600482015273ffffffffffffffffffffffffffffffffffffffff831660248201526044810182905260a06064"
    "8201525f60a482018190526084820152736ae43d3271ff6888e7fc43fd7321a503ff738951906342b0b77c9060c4015f"
    "604051808303815f87803b158015610258575f80fd5b505af115801561026a573d5f803e3d5ffd5b505050508173ffff"
    "ffffffffffffffffffffffffffffffffffff167f508edf42c5f0ad5e7945ee5c07dd6109cab2494ab0954a225272924f"
    "2cdf6e73826040516102b691815260200190565b60405180910390a25050565b5f806102ce86886108de565b6040517f"
    "095ea7b3000000000000000000000000000000000000000000000000000000008152736ae43d3271ff6888e7fc43fd73"
    "21a503ff73895160048201526024810182905290915073ffffffffffffffffffffffffffffffffffffffff8916906309"
    "5ea7b3906044016020604051808303815f875af1158015610355573d5f803e3d5ffd5b505050506040513d601f19601f"
    "8201168201806040525081019061037991906108f7565b506040517f70a0823100000000000000000000000000000000"
    "00000000000000000000000081523060048201525f9073ffffffffffffffffffffffffffffffffffffffff8a16906370"
    "a0823190602401602060405180830381865afa1580156103e4573d5f803e3d5ffd5b505050506040513d601f19601f82"
    "0116820180604052508101906104089190610916565b90505f828211610418575f610422565b610422838361092d565b"
    "90508015610516576001546040517fa9059cbb0000000000000000000000000000000000000000000000000000000081"
    "5273ffffffffffffffffffffffffffffffffffffffff918216600482015260248101839052908b169063a9059cbb9060"
    "44016020604051808303815f875af11580156104a0573d5f803e3d5ffd5b505050506040513d601f19601f8201168201"
    "80604052508101906104c491906108f7565b508973ffffffffffffffffffffffffffffffffffffffff167f0321da6e08"
    "9e85141419470bef6065bca65d51db8cd0866475081119c9877c4a8260405161050d91815260200190565b6040518091"
    "0390a25b5060019998505050505050505050565b"
)

def sep(title):
    print(f"\n{'═'*60}")
    print(f"  {title}")
    print('═'*60)

def test_full():
    h = Hinsdale()
    print(f"\n[TEST] Backend: {h.backend}")

    sep("ANALYSIS")
    r = h.analyze(AUREON_HEX)
    print(r.summary())

    sep("FUNCTION SIGNATURES")
    if r.signatures.functions:
        for f in r.signatures.functions:
            name = f.known_name or "???"
            tgt  = f"→ 0x{f.jump_target:04x}" if f.jump_target else "→ ?"
            print(f"  {f.selector}  {tgt}  {name}")
    else:
        print("  (none detected)")

    if r.signatures.event_topics:
        print("\n  Event topics:")
        for t in r.signatures.event_topics:
            print(f"    {t}")

    sep("SECURITY AUDIT")
    print(f"  Risk score: {r.security.risk_score}/100")
    print(f"  SSTORE: {r.security.sstore_count}  SLOAD: {r.security.sload_count}  CALL: {r.security.call_count}")
    for f in r.security.findings:
        print(f"\n  [{f.severity:8s}] {f.title}")
        print(f"           {f.description}")

    sep("METADATA")
    m = r.metadata
    print(f"  Bytecode size    : {m.bytecode_len} bytes")
    print(f"  Runtime bytecode : {m.is_runtime}")
    print(f"  ERC-20 like      : {m.is_erc20_like}")
    print(f"  Proxy            : {m.is_proxy}")
    if m.solc_version_hint:
        print(f"  Solc hint        : {m.solc_version_hint}")

    sep("CFG")
    print(f"  Blocks      : {r.cfg_summary.block_count}")
    print(f"  Edges       : {r.cfg_summary.edge_count}")
    print(f"  JUMPDESTs   : {r.cfg_summary.jumpdest_count}")

    sep("PSEUDO-SOURCE (first 40 lines)")
    lines = r.decompiled.pseudo_source.splitlines()
    for line in lines[:40]:
        print(line)
    if len(lines) > 40:
        print(f"  ... ({len(lines)-40} more lines)")

    sep("DISASSEMBLY (first 30 instructions)")
    for ins in r.disassembly.instructions[:30]:
        marker = "◆" if ins.opcode == 0x5b else " "
        print(f"  {marker} {ins}")

    sep("TEST PASSED")
    print(f"  Analysis complete in {r.elapsed_ms:.2f}ms")
    print(f"  {r.disassembly.instruction_count} instructions decoded")
    print(f"  {len(r.signatures.functions)} functions recovered")
    print(f"  {len(r.security.findings)} security findings")

if __name__ == "__main__":
    test_full()
