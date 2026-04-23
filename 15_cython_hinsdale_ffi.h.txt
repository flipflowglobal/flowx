// cython/hinsdale_ffi.h — C ABI for libhinsdale.so
// sizeof(HinsInstr)==128, sizeof(HinsSummary)==112
#ifndef HINSDALE_FFI_H
#define HINSDALE_FFI_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct HinsdaleCtx HinsdaleCtx;

// 128 bytes, packed so Cython/numpy can overlay directly
typedef struct __attribute__((packed)) {
    uint32_t offset;        //   0
    uint8_t  opcode;        //   4
    uint8_t  imm_len;       //   5
    uint8_t  stack_in;      //   6
    uint8_t  stack_out;     //   7
    uint8_t  mnemonic[16];  //   8
    uint8_t  category[16];  //  24
    uint8_t  imm_hex[68];   //  40
    uint8_t  _pad[4];       // 108
    uint64_t imm_u64;       // 112
    uint8_t  has_imm_u64;   // 120
    uint8_t  _pad2[7];      // 121
} HinsInstr;                // 128

typedef struct {
    char     severity[16];
    char     title[128];
    char     description[512];
    char     pattern[64];
    int32_t  offset;
    uint8_t  _pad[4];
} HinsFinding;

typedef struct {
    char     selector[12];
    uint32_t selector_u32;
    char     known_name[256];
    int64_t  jump_target;
    uint8_t  is_view;
    uint8_t  _pad[7];
} HinsFnSig;

typedef struct {
    uint32_t bytecode_len;
    uint32_t instruction_count;
    uint32_t block_count;
    uint32_t edge_count;
    uint32_t jumpdest_count;
    uint32_t function_count;
    uint32_t finding_count;
    uint32_t risk_score;
    uint32_t sstore_count;
    uint32_t sload_count;
    uint32_t call_count;
    uint8_t  is_runtime;
    uint8_t  is_proxy;
    uint8_t  is_erc20_like;
    uint8_t  is_erc721_like;
    uint8_t  has_selfdestruct;
    uint8_t  has_delegatecall;
    uint8_t  has_create2;
    uint8_t  _pad;
    double   elapsed_ms;
    char     solc_version_hint[64];
} HinsSummary;

typedef struct { const uint8_t* ptr; size_t len; } BytecodeSlice;
typedef uint8_t (*HinsChunkCallback)(const HinsInstr*, uint32_t, void*);

HinsdaleCtx* hins_analyze        (const uint8_t* bytecode, size_t len);
HinsdaleCtx* hins_analyze_hex    (const char* hex_str, size_t hex_len);
void         hins_free           (HinsdaleCtx* ctx);
int          hins_summary        (const HinsdaleCtx* ctx, HinsSummary* out);
uint32_t     hins_instr_count    (const HinsdaleCtx* ctx);
int          hins_instr_at       (const HinsdaleCtx* ctx, uint32_t idx, HinsInstr* out);
uint32_t     hins_instr_bulk     (const HinsdaleCtx* ctx, HinsInstr* buf, uint32_t n);
uint32_t     hins_instr_bulk_into(const HinsdaleCtx* ctx, uint8_t* dst, uint32_t n);
uint32_t     hins_batch_analyze  (const BytecodeSlice* slices, size_t count, HinsdaleCtx** out);
uint32_t     hins_stream_disasm  (const uint8_t* bytecode, size_t len, uint32_t chunk_size,
                                   HinsChunkCallback cb, void* user_data);
uint32_t     hins_fn_count       (const HinsdaleCtx* ctx);
int          hins_fn_at          (const HinsdaleCtx* ctx, uint32_t idx, HinsFnSig* out);
uint32_t     hins_finding_count  (const HinsdaleCtx* ctx);
int          hins_finding_at     (const HinsdaleCtx* ctx, uint32_t idx, HinsFinding* out);
char*        hins_pseudo_source  (const HinsdaleCtx* ctx);
char*        hins_json           (const HinsdaleCtx* ctx);
void         hins_free_str       (char* ptr);
uint32_t     hins_jumpdests      (const HinsdaleCtx* ctx, uint32_t* buf, uint32_t n);
const char*  hins_version        (void);
uint32_t     hins_sizeof_instr   (void);
uint32_t     hins_sizeof_summary (void);

#ifdef __cplusplus
}
#endif
#endif
