
cdef class HinsdaleContext:
    """
    Opaque handle to a Rust HinsdaleReport on the heap.

    Lifecycle:
        ctx = HinsdaleContext.from_bytes(b)   # or from_hex("0x...")
        # ... use ctx ...
        # ctx freed automatically at GC / end of with block

    Key methods:
        ctx.summary()              → Summary  (stack-only, no alloc)
        ctx.instructions()         → list[Instruction]
        ctx.instructions_numpy()   → np.ndarray[INSTR_DTYPE]  ← FASTEST
        ctx.functions()            → list[FunctionSig]
        ctx.findings()             → list[Finding]
        ctx.pseudo_source()        → str
        ctx.json()                 → str
        ctx.jumpdests()            → list[int]
        ctx.risk_score()           → int
    """
    cdef HinsdaleCtx* _ptr

    def __cinit__(self):
        self._ptr = NULL

    def __dealloc__(self):
        if self._ptr != NULL:
            with nogil:
                hins_free(self._ptr)
            self._ptr = NULL

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self._ptr != NULL:
            with nogil:
                hins_free(self._ptr)
            self._ptr = NULL

    # ── Constructors ─────────────────────────────────────────────────────

    @staticmethod
    def from_bytes(data):
        """
        Analyze raw bytecode bytes. GIL released during Rust analysis.

        Parameters
        ----------
        data : bytes | bytearray | memoryview
        """
        cdef HinsdaleContext self_ = HinsdaleContext.__new__(HinsdaleContext)
        if not isinstance(data, (bytes, bytearray)):
            data = bytes(data)
        if isinstance(data, bytearray):
            data = bytes(data)
        cdef const uint8_t* ptr = <const uint8_t*>PyBytes_AS_STRING(data)
        cdef size_t n           = <size_t>PyBytes_GET_SIZE(data)
        if n == 0:
            raise ValueError("bytecode is empty")
        with nogil:
            self_._ptr = hins_analyze(ptr, n)
        if self_._ptr == NULL:
            raise RuntimeError("hins_analyze returned NULL")
        return self_

    @staticmethod
    def from_hex(str hex_str):
        """
        Analyze hex-encoded bytecode. GIL released during Rust analysis.
        Accepts '0x...' or plain hex.
        """
        cdef HinsdaleContext self_ = HinsdaleContext.__new__(HinsdaleContext)
        clean = hex_str.strip()
        if clean.startswith(('0x', '0X')):
            clean = clean[2:]
        cdef bytes enc  = clean.encode('ascii')
        cdef const char* cs = <const char*>PyBytes_AS_STRING(enc)
        cdef size_t      cl = <size_t>PyBytes_GET_SIZE(enc)
        with nogil:
            self_._ptr = hins_analyze_hex(cs, cl)
        if self_._ptr == NULL:
            raise RuntimeError("hins_analyze_hex returned NULL — invalid hex?")
        return self_

    # ── Summary ───────────────────────────────────────────────────────────

    cpdef Summary summary(self):
        """Return stats. Stack-allocated — no heap allocation in Rust or Python."""
        cdef HinsSummary s
        cdef int rc
        with nogil:
            rc = hins_summary(self._ptr, &s)
        if rc != 0:
            raise RuntimeError("hins_summary failed")
        return Summary._from_c(&s)

    # ── Instructions ─────────────────────────────────────────────────────

    cpdef list instructions(self):
        """
        Return all instructions as list[Instruction].
        Uses bulk copy into single malloc'd buffer (one syscall to Rust).
        """
        cdef uint32_t n
        with nogil:
            n = hins_instr_count(self._ptr)
        if n == 0:
            return []

        cdef HinsInstr* buf = <HinsInstr*>PyMem_Malloc(n * 128)
        if not buf:
            raise MemoryError()
        cdef uint32_t got
        try:
            with nogil:
                got = hins_instr_bulk(self._ptr, buf, n)
            result = [None] * got
            for i in range(got):
                result[i] = Instruction._from_c(&buf[i])
            return result
        finally:
            PyMem_Free(buf)

    def instructions_numpy(self):
        """
        Return all instructions as numpy structured array (shape N, dtype INSTR_DTYPE).

        ZERO-COPY path:
          1. Allocate numpy array (128*N bytes)
          2. Call hins_instr_bulk_into(ctx, arr.data, N)
             → Rust writes HinsInstr structs directly into numpy's buffer
          3. Return — no intermediate buffer, no memcpy in Python

        Fields: offset/u32, opcode/u1, imm_len/u1, stack_in/u1, stack_out/u1,
                mnemonic/S16, category/S16, imm_hex/S68, imm_u64/u8, has_imm_u64/u1
        """
        cdef uint32_t n
        with nogil:
            n = hins_instr_count(self._ptr)
        if n == 0:
            return np.empty(0, dtype=INSTR_DTYPE)

        # Allocate numpy array — Rust writes directly into this memory
        cdef np.ndarray arr = np.empty(n, dtype=INSTR_DTYPE)

        # Get raw pointer to numpy's data buffer
        cdef uint8_t* data_ptr = <uint8_t*><size_t>arr.ctypes.data

        cdef uint32_t written
        with nogil:
            written = hins_instr_bulk_into(self._ptr, data_ptr, n)

        if written < n:
            arr = arr[:written]
        return arr

    # ── Functions & findings ──────────────────────────────────────────────

    cpdef list functions(self):
        """Return list[FunctionSig]."""
        cdef uint32_t n
        with nogil:
            n = hins_fn_count(self._ptr)
        cdef list result = [None] * n
        cdef HinsFnSig sig
        for i in range(n):
            with nogil:
                hins_fn_at(self._ptr, i, &sig)
            result[i] = FunctionSig._from_c(&sig)
        return result

    cpdef list findings(self):
        """Return list[Finding]."""
        cdef uint32_t n
        with nogil:
            n = hins_finding_count(self._ptr)
        cdef list result = [None] * n
        cdef HinsFinding f
        for i in range(n):
            with nogil:
                hins_finding_at(self._ptr, i, &f)
            result[i] = Finding._from_c(&f)
        return result

    # ── Strings ───────────────────────────────────────────────────────────

    cpdef str pseudo_source(self):
        """Decompiled pseudo-Solidity. Rust allocates; freed immediately after copy."""
        cdef char* raw
        with nogil:
            raw = hins_pseudo_source(self._ptr)
        if raw == NULL:
            return ""
        try:
            return (<bytes>raw[:]).decode('utf-8', errors='replace')
        finally:
            with nogil:
                hins_free_str(raw)

    cpdef str json(self):
        """Full JSON report string."""
        cdef char* raw
        with nogil:
            raw = hins_json(self._ptr)
        if raw == NULL:
            return "{}"
        try:
            return (<bytes>raw[:]).decode('utf-8', errors='replace')
        finally:
            with nogil:
                hins_free_str(raw)

    # ── Jump destinations ─────────────────────────────────────────────────

    cpdef list jumpdests(self):
        """Return list of all JUMPDEST byte offsets."""
        cdef uint32_t cap
        with nogil:
            cap = hins_instr_count(self._ptr)   # upper bound
        cdef uint32_t* buf = <uint32_t*>PyMem_Malloc(cap * sizeof(uint32_t))
        if not buf:
            raise MemoryError()
        cdef uint32_t n
        try:
            with nogil:
                n = hins_jumpdests(self._ptr, buf, cap)
            return [buf[i] for i in range(n)]
        finally:
            PyMem_Free(buf)

    # ── Fast scalar accessors (no Summary object) ──────────────────────────

    cpdef uint32_t risk_score(self):
        cdef HinsSummary s
        with nogil: hins_summary(self._ptr, &s)
        return s.risk_score

    cpdef double elapsed_ms(self):
        cdef HinsSummary s
        with nogil: hins_summary(self._ptr, &s)
        return s.elapsed_ms

    cpdef uint32_t instruction_count(self):
        cdef uint32_t n
        with nogil: n = hins_instr_count(self._ptr)
        return n

    def __repr__(self):
        s = self.summary()
        return f"<HinsdaleContext {s.bytecode_len}b risk={s.risk_score} {s.elapsed_ms:.1f}ms>"


# ── Module-level functions ────────────────────────────────────────────────

def analyze(bytecode):
    """
    Analyze EVM bytecode. Returns HinsdaleContext.

    Parameters
    ----------
    bytecode : bytes | bytearray | str
        Raw bytes or hex string (with/without 0x).
    """
    if isinstance(bytecode, str):
        return HinsdaleContext.from_hex(bytecode)
    return HinsdaleContext.from_bytes(bytecode)


def analyze_hex(str hex_str):
    return HinsdaleContext.from_hex(hex_str)


def batch_analyze(list bytecodes):
    """
    Analyze multiple bytecodes in parallel using rayon.
    GIL released for the entire parallel section.

    Parameters
    ----------
    bytecodes : list of bytes | list of str (hex)

    Returns
    -------
    list of HinsdaleContext
    """
    cdef size_t n = len(bytecodes)
    if n == 0:
        return []

    # Normalize all inputs to bytes
    cdef list raw_list = []
    for b in bytecodes:
        if isinstance(b, str):
            clean = b.strip()
            if clean.startswith(('0x', '0X')): clean = clean[2:]
            raw_list.append(bytes.fromhex(clean))
        elif isinstance(b, bytearray):
            raw_list.append(bytes(b))
        else:
            raw_list.append(b)

    # Build BytecodeSlice array (C-level)
    cdef BytecodeSlice* slices = <BytecodeSlice*>PyMem_Malloc(n * sizeof(BytecodeSlice))
    if not slices:
        raise MemoryError()

    cdef HinsdaleCtx** out_ctxs = <HinsdaleCtx**>PyMem_Malloc(n * sizeof(HinsdaleCtx*))
    if not out_ctxs:
        PyMem_Free(slices)
        raise MemoryError()

    try:
        # Fill slice array — keep Python objects alive during the nogil section
        for i in range(n):
            slices[i].ptr = <const uint8_t*>PyBytes_AS_STRING(<bytes>raw_list[i])
            slices[i].len = <size_t>PyBytes_GET_SIZE(<bytes>raw_list[i])
        memset(out_ctxs, 0, n * sizeof(HinsdaleCtx*))

        cdef uint32_t done
        with nogil:
            done = hins_batch_analyze(slices, n, out_ctxs)

        # Wrap results in HinsdaleContext objects
        results = []
        for i in range(done):
            if out_ctxs[i] != NULL:
                ctx = HinsdaleContext.__new__(HinsdaleContext)
                (<HinsdaleContext>ctx)._ptr = out_ctxs[i]
                results.append(ctx)
        return results
    finally:
        PyMem_Free(slices)
        PyMem_Free(out_ctxs)


def stream_disasm(bytecode, uint32_t chunk_size=256):
    """
    Stream disassembly for very large bytecodes.
    Yields lists of instruction dicts in chunks.

    Parameters
    ----------
    bytecode   : bytes | str
    chunk_size : instructions per chunk (default 256)

    Yields
    ------
    list of dict  (one per chunk)
    """
    if isinstance(bytecode, str):
        clean = bytecode.strip().lstrip('0x').lstrip('0X')
        bytecode = bytes.fromhex(clean)
    elif isinstance(bytecode, bytearray):
        bytecode = bytes(bytecode)

    cdef const uint8_t* ptr = <const uint8_t*>PyBytes_AS_STRING(<bytes>bytecode)
    cdef size_t          n  = <size_t>PyBytes_GET_SIZE(<bytes>bytecode)

    cdef list all_chunks = []
    cdef StreamState state
    state.chunks = <PyObject*>all_chunks
    state.total  = 0

    # hins_stream_disasm calls _stream_callback with each chunk
    # The callback acquires GIL and appends to all_chunks
    with nogil:
        hins_stream_disasm(ptr, n, chunk_size, _stream_callback, &state)

    for chunk in all_chunks:
        yield chunk


def disasm_numpy(bytecode):
    """
    Fast disassembly — returns numpy array directly.
    Alias for: analyze(bytecode).instructions_numpy()
    """
    return analyze(bytecode).instructions_numpy()


def version():
    """Return libhinsdale version string."""
    cdef const char* v
    with nogil:
        v = hins_version()
    return (<bytes>v).decode('ascii')


def sizeof_instr():
    """Return sizeof(HinsInstr) as reported by Rust (should be 128)."""
    cdef uint32_t s
    with nogil: s = hins_sizeof_instr()
    return s


__all__ = [
    "HinsdaleContext",
    "Instruction",
    "FunctionSig",
    "Finding",
    "Summary",
    "analyze",
    "analyze_hex",
    "batch_analyze",
    "stream_disasm",
    "disasm_numpy",
    "version",
    "sizeof_instr",
    "INSTR_DTYPE",
    "INSTR_SIZE",
]
