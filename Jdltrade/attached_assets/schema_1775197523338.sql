-- nexus-arb database schema
-- SQLite WAL mode for concurrent read/write on ARM devices

PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store   = MEMORY;
PRAGMA mmap_size    = 134217728;  -- 128MB memory-mapped I/O
PRAGMA cache_size   = -32000;     -- 32MB page cache

-- ── Opportunities ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunities (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id              INTEGER NOT NULL DEFAULT 1,
    route_hash            TEXT    NOT NULL,
    token_in              TEXT    NOT NULL,
    loan_amount_wei       TEXT    NOT NULL,
    expected_profit_usd   REAL    NOT NULL,
    profit_std_usd        REAL    NOT NULL DEFAULT 0,
    profit_p10_usd        REAL    NOT NULL DEFAULT 0,
    profit_p50_usd        REAL    NOT NULL DEFAULT 0,
    profit_p90_usd        REAL    NOT NULL DEFAULT 0,
    profit_probability    REAL    NOT NULL DEFAULT 0,
    viability_probability REAL    NOT NULL DEFAULT 0,
    gas_estimate_gwei     REAL    NOT NULL DEFAULT 0,
    composite_score       REAL    NOT NULL DEFAULT 0,
    kelly_fraction        REAL,
    status                TEXT    NOT NULL DEFAULT 'detected',
    created_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Trades ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id    INTEGER REFERENCES opportunities(id),
    chain_id          INTEGER NOT NULL DEFAULT 1,
    tx_hash           TEXT    UNIQUE,
    token             TEXT    NOT NULL DEFAULT '',
    loan_amount_wei   TEXT    NOT NULL DEFAULT '0',
    gross_profit_wei  TEXT,
    gas_cost_wei      TEXT,
    net_profit_wei    TEXT,
    net_profit_usd    REAL,
    status            TEXT    NOT NULL,
    revert_reason     TEXT,
    block_number      INTEGER,
    gas_used          INTEGER,
    inclusion_blocks  INTEGER,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    confirmed_at      INTEGER
);

-- ── AI Decisions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_decisions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id       INTEGER REFERENCES opportunities(id),
    ppo_score            REAL NOT NULL DEFAULT 0,
    thompson_score       REAL NOT NULL DEFAULT 0,
    ukf_score            REAL NOT NULL DEFAULT 0,
    cma_es_score         REAL NOT NULL DEFAULT 0,
    composite_score      REAL NOT NULL DEFAULT 0,
    ppo_weight           REAL NOT NULL DEFAULT 0.25,
    thompson_weight      REAL NOT NULL DEFAULT 0.25,
    ukf_weight           REAL NOT NULL DEFAULT 0.25,
    cma_es_weight        REAL NOT NULL DEFAULT 0.25,
    decision             TEXT NOT NULL,
    recommended_loan_usd REAL NOT NULL DEFAULT 0,
    reasoning            TEXT,
    actual_outcome_usd   REAL,
    created_at           INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Pool Performance ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pool_performance (
    pool_address           TEXT    NOT NULL,
    chain_id               INTEGER NOT NULL DEFAULT 1,
    protocol               TEXT    NOT NULL DEFAULT '',
    total_routes_scanned   INTEGER NOT NULL DEFAULT 0,
    successful_routes      INTEGER NOT NULL DEFAULT 0,
    total_profit_usd       REAL    NOT NULL DEFAULT 0,
    avg_profit_usd         REAL    NOT NULL DEFAULT 0,
    sharpe_ratio           REAL    NOT NULL DEFAULT 0,
    last_seen              INTEGER,
    ema_weight             REAL    NOT NULL DEFAULT 1.0,
    PRIMARY KEY (pool_address, chain_id)
);

-- ── Engine Weights (Shapley history) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engine_weights (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ppo_weight          REAL NOT NULL DEFAULT 0.25,
    thompson_weight     REAL NOT NULL DEFAULT 0.25,
    ukf_weight          REAL NOT NULL DEFAULT 0.25,
    cma_es_weight       REAL NOT NULL DEFAULT 0.25,
    trades_evaluated    INTEGER NOT NULL DEFAULT 0,
    shapley_values_json TEXT NOT NULL DEFAULT '{}',
    recorded_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Replay Buffer (PER) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replay_buffer (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    state_json   TEXT    NOT NULL,
    action       INTEGER NOT NULL,
    reward       REAL    NOT NULL,
    next_state_json TEXT NOT NULL,
    td_error     REAL    NOT NULL DEFAULT 1.0,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── System Stats ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_stats (
    stat_key   TEXT    PRIMARY KEY,
    stat_value TEXT    NOT NULL,
    recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trades_status      ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created     ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_profit      ON trades(net_profit_usd DESC);
CREATE INDEX IF NOT EXISTS idx_opps_score         ON opportunities(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_opps_created       ON opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pool_sharpe        ON pool_performance(sharpe_ratio DESC);
CREATE INDEX IF NOT EXISTS idx_replay_priority    ON replay_buffer(td_error DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_opp   ON ai_decisions(opportunity_id);
