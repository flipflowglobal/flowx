// src/ffi.rs — C ABI wrapper for Cython
//
// LAYOUT GUARANTEE:
//   HinsInstr is exactly 128 bytes, field offsets match hinsdale_ffi.h and INSTR_DTYPE.
//   Verified: sizeof == 128, no hidden compiler padding (explicit _pad fields).
//
// Safety contract:
//   - All *const HinsdaleCtx from Box::into_raw — never null after hins_analyze
//   - hins_free called exactly once per ctx
//   - hins_free_str called for every string from hins_pseudo_source / hins_json
//   - hins_analyze / hins_batch_analyze are fully thread-safe

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};
use crate::{analyze, parse_hex, HinsdaleReport};

// ── Opaque context ─────────────────────────────────────────────────────────

pub struct HinsdaleCtx(HinsdaleReport);

// ── HinsInstr — 128 bytes, fully explicit layout ───────────────────────────
//
//   off  0   u32  offset
//   off  4   u8   opcode
//   off  5   u8   imm_len
//   off  6   u8   stack_in
//   off  7   u8   stack_out
//   off  8   [u8;16]  mnemonic
//   off 24   [u8;16]  category
//   off 40   [u8;68]  imm_hex
//   off 108  [u8;4]   _pad (align imm_u64 to 8)
//   off 112  u64  imm_u64
//   off 120  u8   has_imm_u64
//   off 121  [u8;7]   _pad2 (align struct to 8)
//   total = 128

#[repr(C)]
pub struct HinsInstr {
    pub offset:       u32,
    pub opcode:       u8,
    pub imm_len:      u8,
    pub stack_in:     u8,
    pub stack_out:    u8,
    pub mnemonic:     [u8; 16],
    pub category:     [u8; 16],
    pub imm_hex:      [u8; 68],
    pub _pad:         [u8; 4],
    pub imm_u64:      u64,
    pub has_imm_u64:  u8,
    pub _pad2:        [u8; 7],
}

// Compile-time size assertion
const _: () = assert!(std::mem::size_of::<HinsInstr>() == 128);

impl HinsInstr {
    #[inline(always)]
    fn from_instr(ins: &crate::disasm::Instruction) -> Self {
        let mut mnemonic = [0u8; 16];
        let mb = ins.mnemonic.as_bytes();
        let ml = mb.len().min(15);
        mnemonic[..ml].copy_from_slice(&mb[..ml]);

        let mut category = [0u8; 16];
        let cb = ins.category.as_bytes();
        let cl = cb.len().min(15);
        category[..cl].copy_from_slice(&cb[..cl]);

        let mut imm_hex = [0u8; 68];
        let (imm_len, imm_u64, has_imm_u64) = match &ins.imm {
            Some(h) => {
                let hb = h.as_bytes();
                let hl = hb.len().min(67);
                imm_hex[..hl].copy_from_slice(&hb[..hl]);
                let v   = ins.imm_u256.unwrap_or(0);
                let has = ins.imm_u256.is_some() as u8;
                ((hb.len() / 2) as u8, v, has)
            }
            None => (0, 0, 0),
        };

        HinsInstr {
            offset: ins.offset as u32,
            opcode: ins.opcode,
            imm_len,
            stack_in:  ins.stack_in as u8,
            stack_out: ins.stack_out as u8,
            mnemonic,
            category,
            imm_hex,
            _pad:        [0; 4],
            imm_u64,
            has_imm_u64,
            _pad2:       [0; 7],
        }
    }
}

// ── Other flat structs ────────────────────────────────────────────────────

#[repr(C)]
pub struct HinsFinding {
    pub severity:    [u8; 16],
    pub title:       [u8; 128],
    pub description: [u8; 512],
    pub pattern:     [u8; 64],
    pub offset:      i32,
    pub _pad:        [u8; 4],
}

#[repr(C)]
pub struct HinsFnSig {
    pub selector:     [u8; 12],
    pub selector_u32: u32,
    pub known_name:   [u8; 256],
    pub jump_target:  i64,
    pub is_view:      u8,
    pub _pad:         [u8; 7],
}

#[repr(C)]
pub struct HinsSummary {
    pub bytecode_len:      u32,
    pub instruction_count: u32,
    pub block_count:       u32,
    pub edge_count:        u32,
    pub jumpdest_count:    u32,
    pub function_count:    u32,
    pub finding_count:     u32,
    pub risk_score:        u32,
    pub sstore_count:      u32,
    pub sload_count:       u32,
    pub call_count:        u32,
    pub is_runtime:        u8,
    pub is_proxy:          u8,
    pub is_erc20_like:     u8,
    pub is_erc721_like:    u8,
    pub has_selfdestruct:  u8,
    pub has_delegatecall:  u8,
    pub has_create2:       u8,
    pub _pad:              u8,
    pub elapsed_ms:        f64,
    pub solc_version_hint: [u8; 64],
}

// ── Batch result — array of HinsSummary (parallel analysis output) ─────────

#[repr(C)]
pub struct HinsBatchResult {
    pub count:    u32,
    pub _pad:     [u8; 4],
    pub contexts: *mut *mut HinsdaleCtx,  // array of ctx pointers
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn copy_str(dst: &mut [u8], src: &str) {
    let b   = src.as_bytes();
    let len = b.len().min(dst.len() - 1);
    dst[..len].copy_from_slice(&b[..len]);
    dst[len] = 0;
}

unsafe fn ctx_ref<'a>(ctx: *const HinsdaleCtx) -> Option<&'a HinsdaleReport> {
    if ctx.is_null() { None } else { Some(&(*ctx).0) }
}

fn fill_summary(report: &HinsdaleReport, out: &mut HinsSummary) {
    let mut hint = [0u8; 64];
    if let Some(ref h) = report.metadata.solc_version_hint { copy_str(&mut hint, h); }
    out.bytecode_len      = report.metadata.bytecode_len as u32;
    out.instruction_count = report.disassembly.instruction_count as u32;
    out.block_count       = report.cfg_summary.block_count as u32;
    out.edge_count        = report.cfg_summary.edge_count as u32;
    out.jumpdest_count    = report.cfg_summary.jumpdest_count as u32;
    out.function_count    = report.signatures.functions.len() as u32;
    out.finding_count     = report.security.findings.len() as u32;
    out.risk_score        = report.security.risk_score;
    out.sstore_count      = report.security.sstore_count as u32;
    out.sload_count       = report.security.sload_count as u32;
    out.call_count        = report.security.call_count as u32;
    out.is_runtime        = report.metadata.is_runtime as u8;
    out.is_proxy          = report.metadata.is_proxy as u8;
    out.is_erc20_like     = report.metadata.is_erc20_like as u8;
    out.is_erc721_like    = report.metadata.is_erc721_like as u8;
    out.has_selfdestruct  = report.security.has_selfdestruct as u8;
    out.has_delegatecall  = report.security.has_delegatecall as u8;
    out.has_create2       = report.security.has_create2 as u8;
    out._pad              = 0;
    out.elapsed_ms        = report.elapsed_ms;
    out.solc_version_hint = hint;
}

// ════════════════════════════════════════════════════════════════════════════
// CORE API
// ════════════════════════════════════════════════════════════════════════════

#[no_mangle]
pub extern "C" fn hins_analyze(bytecode: *const u8, len: usize) -> *mut HinsdaleCtx {
    if bytecode.is_null() || len == 0 { return std::ptr::null_mut(); }
    let slice  = unsafe { std::slice::from_raw_parts(bytecode, len) };
    let report = analyze(slice);
    Box::into_raw(Box::new(HinsdaleCtx(report)))
}

#[no_mangle]
pub extern "C" fn hins_analyze_hex(hex_str: *const c_char, _hex_len: usize) -> *mut HinsdaleCtx {
    if hex_str.is_null() { return std::ptr::null_mut(); }
    let s = unsafe { CStr::from_ptr(hex_str) }.to_str().unwrap_or("");
    match parse_hex(s) {
        Ok(bytes) if !bytes.is_empty() => Box::into_raw(Box::new(HinsdaleCtx(analyze(&bytes)))),
        _ => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn hins_free(ctx: *mut HinsdaleCtx) {
    if !ctx.is_null() { unsafe { drop(Box::from_raw(ctx)); } }
}

#[no_mangle]
pub extern "C" fn hins_summary(ctx: *const HinsdaleCtx, out: *mut HinsSummary) -> c_int {
    let report = match unsafe { ctx_ref(ctx) } { Some(r) => r, None => return -1 };
    if out.is_null() { return -1; }
    unsafe { fill_summary(report, &mut *out); }
    0
}

// ── Disassembly ───────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn hins_instr_count(ctx: *const HinsdaleCtx) -> u32 {
    unsafe { ctx_ref(ctx) }.map(|r| r.disassembly.instruction_count as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn hins_instr_at(ctx: *const HinsdaleCtx, idx: u32, out: *mut HinsInstr) -> c_int {
    let report = match unsafe { ctx_ref(ctx) } { Some(r) => r, None => return -1 };
    let ins    = match report.disassembly.instructions.get(idx as usize) { Some(i) => i, None => return -1 };
    if out.is_null() { return -1; }
    unsafe { *out = HinsInstr::from_instr(ins); }
    0
}

/// Standard bulk copy into caller-provided C buffer.
#[no_mangle]
pub extern "C" fn hins_instr_bulk(ctx: *const HinsdaleCtx, buf: *mut HinsInstr, buf_count: u32) -> u32 {
    let report = match unsafe { ctx_ref(ctx) } { Some(r) => r, None => return 0 };
    if buf.is_null() { return 0; }
    let instrs = &report.disassembly.instructions;
    let n      = instrs.len().min(buf_count as usize);
    for i in 0..n {
        unsafe { *buf.add(i) = HinsInstr::from_instr(&instrs[i]); }
    }
    n as u32
}

/// ZERO-COPY path: write directly into numpy array's own memory.
/// `dst` must point to at least `buf_count * 128` bytes (numpy array data pointer).
/// Returns number of instructions written.
/// This eliminates the intermediate C buffer in instructions_numpy().
#[no_mangle]
pub extern "C" fn hins_instr_bulk_into(
    ctx:       *const HinsdaleCtx,
    dst:       *mut u8,
    buf_count: u32,
) -> u32 {
    let report = match unsafe { ctx_ref(ctx) } { Some(r) => r, None => return 0 };
    if dst.is_null() { return 0; }
    let instrs = &report.disassembly.instructions;
    let n      = instrs.len().min(buf_count as usize);
    // Write each HinsInstr directly into dst at stride 128
    for i in 0..n {
        let ins_c = HinsInstr::from_instr(&instrs[i]);
        unsafe {
            let slot = dst.add(i * 128) as *mut HinsInstr;
            *slot = ins_c;
        }
    }
    n as u32
}

// ── Parallel batch analysis (rayon) ───────────────────────────────────────
//
// Input: array of (ptr, len) pairs — each is one bytecode to analyze.
// Output: array of HinsdaleCtx* — one per input.
// All analyses run in parallel on rayon's thread pool.
// Caller frees each ctx with hins_free, then frees ptrs/lens arrays.

#[repr(C)]
pub struct BytecodeSlice {
    pub ptr: *const u8,
    pub len: usize,
}

// Safety: we only read from these pointers during the parallel section,
// which is scoped to this function's lifetime.
unsafe impl Send for BytecodeSlice {}
unsafe impl Sync for BytecodeSlice {}

#[no_mangle]
pub extern "C" fn hins_batch_analyze(
    slices:    *const BytecodeSlice,
    count:     usize,
    out_ctxs:  *mut *mut HinsdaleCtx,
) -> u32 {
    if slices.is_null() || out_ctxs.is_null() || count == 0 { return 0; }

    let inputs: &[BytecodeSlice] = unsafe { std::slice::from_raw_parts(slices, count) };

    // Analyze all in parallel via rayon
    use rayon::prelude::*;
    let results: Vec<*mut HinsdaleCtx> = inputs
        .par_iter()
        .map(|s| {
            if s.ptr.is_null() || s.len == 0 {
                return std::ptr::null_mut();
            }
            let slice  = unsafe { std::slice::from_raw_parts(s.ptr, s.len) };
            let report = analyze(slice);
            Box::into_raw(Box::new(HinsdaleCtx(report)))
        })
        .collect();

    // Copy results into caller-provided output array
    for (i, ctx_ptr) in results.iter().enumerate() {
        unsafe { *out_ctxs.add(i) = *ctx_ptr; }
    }

    results.len() as u32
}

// ── Streaming chunk disasm (for huge bytecodes) ───────────────────────────
//
// Processes bytecode in `chunk_size` instruction chunks.
// Caller provides a callback: fn(instrs_ptr, count, user_data) -> bool
// Returning false from callback stops iteration early.

pub type ChunkCallback = unsafe extern "C" fn(
    instrs:    *const HinsInstr,
    count:     u32,
    user_data: *mut std::os::raw::c_void,
) -> u8;  // return 0 to stop, 1 to continue

#[no_mangle]
pub extern "C" fn hins_stream_disasm(
    bytecode:   *const u8,
    len:        usize,
    chunk_size: u32,
    callback:   ChunkCallback,
    user_data:  *mut std::os::raw::c_void,
) -> u32 {
    if bytecode.is_null() || len == 0 { return 0; }
    let data = unsafe { std::slice::from_raw_parts(bytecode, len) };

    // Full disasm first (already O(n))
    let disasm = crate::disasm::disassemble(data);
    let instrs = &disasm.instructions;
    let chunk  = chunk_size.max(1) as usize;
    let mut total_delivered = 0u32;

    let mut buf: Vec<HinsInstr> = Vec::with_capacity(chunk);

    for chunk_slice in instrs.chunks(chunk) {
        buf.clear();
        for ins in chunk_slice {
            buf.push(HinsInstr::from_instr(ins));
        }
        let cont = unsafe {
            callback(buf.as_ptr(), buf.len() as u32, user_data)
        };
        total_delivered += buf.len() as u32;
        if cont == 0 { break; }
    }

    total_delivered
}

// ── Signatures ────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn hins_fn_count(ctx: *const HinsdaleCtx) -> u32 {
    unsafe { ctx_ref(ctx) }.map(|r| r.signatures.functions.len() as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn hins_fn_at(ctx: *const HinsdaleCtx, idx: u32, out: *mut HinsFnSig) -> c_int {
    let report = match unsafe { ctx_ref(ctx) } { Some(r) => r, None => return -1 };
    let sig    = match report.signatures.functions.get(idx as usize) { Some(s) => s, None => return -1 };
    if out.is_null() { return -1; }
    unsafe {
        let o = &mut *out;
        copy_str(&mut o.selector, &sig.selector);
        o.selector_u32 = sig.selector_u32;
        if let Some(ref n) = sig.known_name { copy_str(&mut o.known_name, n); }
        else { o.known_name[0] = 0; }
        o.jump_target  = sig.jump_target.map(|t| t as i64).unwrap_or(-1);
        o.is_view      = sig.is_view as u8;
        o._pad         = [0; 7];
    }
    0
}

// ── Security ──────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn hins_finding_count(ctx: *const HinsdaleCtx) -> u32 {
    unsafe { ctx_ref(ctx) }.map(|r| r.security.findings.len() as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn hins_finding_at(ctx: *const HinsdaleCtx, idx: u32, out: *mut HinsFinding) -> c_int {
    let report  = match unsafe { ctx_ref(ctx) } { Some(r) => r, None => return -1 };
    let finding = match report.security.findings.get(idx as usize) { Some(f) => f, None => return -1 };
    if out.is_null() { return -1; }
    unsafe {
        let o = &mut *out;
        copy_str(&mut o.severity,    &finding.severity.to_string());
        copy_str(&mut o.title,       &finding.title);
        copy_str(&mut o.description, &finding.description);
        copy_str(&mut o.pattern,     &finding.pattern);
        o.offset = finding.offset.map(|x| x as i32).unwrap_or(-1);
        o._pad   = [0; 4];
    }
    0
}

// ── Strings ───────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn hins_pseudo_source(ctx: *const HinsdaleCtx) -> *mut c_char {
    match unsafe { ctx_ref(ctx) } {
        None    => std::ptr::null_mut(),
        Some(r) => CString::new(r.decompiled.pseudo_source.as_str())
            .map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut()),
    }
}

#[no_mangle]
pub extern "C" fn hins_json(ctx: *const HinsdaleCtx) -> *mut c_char {
    match unsafe { ctx_ref(ctx) } {
        None    => std::ptr::null_mut(),
        Some(r) => serde_json::to_string(r).ok()
            .and_then(|s| CString::new(s).ok())
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut()),
    }
}

#[no_mangle]
pub extern "C" fn hins_free_str(ptr: *mut c_char) {
    if !ptr.is_null() { unsafe { drop(CString::from_raw(ptr)); } }
}

// ── Jump destinations ─────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn hins_jumpdests(ctx: *const HinsdaleCtx, buf: *mut u32, buf_count: u32) -> u32 {
    let report = match unsafe { ctx_ref(ctx) } { Some(r) => r, None => return 0 };
    if buf.is_null() { return 0; }
    let dests = &report.disassembly.jumpdests;
    let n     = dests.len().min(buf_count as usize);
    for i in 0..n { unsafe { *buf.add(i) = dests[i] as u32; } }
    n as u32
}

// ── Version ────────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn hins_version() -> *const c_char {
    b"1.0.0-cython\0".as_ptr() as *const c_char
}

// ── Struct size query (for runtime verification) ──────────────────────────

#[no_mangle]
pub extern "C" fn hins_sizeof_instr() -> u32 { std::mem::size_of::<HinsInstr>() as u32 }

#[no_mangle]
pub extern "C" fn hins_sizeof_summary() -> u32 { std::mem::size_of::<HinsSummary>() as u32 }
