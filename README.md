# flowx

Hybrid Rust + Python EVM analysis stack (Hinsdale) with CLI, FFI, and Python integration.

## Hybrid architecture (Mermaid)

```mermaid
flowchart LR
  A[Bytecode Input] --> B[hinsdale-cli<br/>src/main.rs]
  A --> C[Rust Core Library<br/>src/lib.rs]
  C --> D[Disassembly + CFG + Signatures + Security]
  C --> E[Symbolic Execution<br/>src/symbolic.rs]
  E --> F[Decompiler<br/>src/decompiler.rs]
  C --> G[C FFI Layer<br/>src/ffi.rs]
  G --> H[Cython Bridge<br/>hinsdale/cython/*.pyx]
  H --> I[Python API + REPL<br/>hinsdale/python/*]
  C --> J[JSON / Report Output]
```

## Hinsdale scaffolding

- Rust core: `/home/runner/work/flowx/flowx/hinsdale/src`
- Cython bridge: `/home/runner/work/flowx/flowx/hinsdale/cython`
- Python API + REPL: `/home/runner/work/flowx/flowx/hinsdale/python`
- Tests/benchmarks: `/home/runner/work/flowx/flowx/hinsdale/tests`
