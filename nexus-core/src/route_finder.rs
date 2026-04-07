use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use smallvec::SmallVec;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pool {
    pub address: String,
    pub token0: String,
    pub token1: String,
    pub protocol: String,
    pub fee: u32,
    pub liquidity: u128,
    pub price: f64, // price of token1 in terms of token0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapStep {
    pub pool: String,
    pub token_in: String,
    pub token_out: String,
    pub protocol: String,
    pub fee: u32,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Route {
    pub steps: Vec<SwapStep>,
    pub expected_profit: f64,
}

pub struct Graph {
    // adjacency list: token_in -> list of (token_out, pool_index)
    pub adj: HashMap<String, Vec<(String, usize)>>,
    pub pools: Vec<Pool>,
}

impl Graph {
    pub fn new(pools: Vec<Pool>) -> Self {
        let mut adj = HashMap::new();
        for (i, pool) in pools.iter().enumerate() {
            // Forward edge
            adj.entry(pool.token0.clone())
                .or_insert_with(Vec::new)
                .push((pool.token1.clone(), i));
            // Reverse edge
            adj.entry(pool.token1.clone())
                .or_insert_with(Vec::new)
                .push((pool.token0.clone(), i));
        }
        Graph { adj, pools }
    }

    /// Find all profitable cycles starting and ending with start_token
    /// using a depth-limited search (max_hops).
    /// This is a simplified version of the RICH algorithm's core search.
    pub fn find_arbitrage_routes(
        &self,
        start_token: &str,
        max_hops: usize,
        min_profit_threshold: f64,
    ) -> Vec<Route> {
        let mut routes = Vec::new();
        let mut current_path: Vec<SwapStep> = Vec::with_capacity(max_hops);
        
        self.dfs(
            start_token,
            start_token,
            1.0,
            max_hops,
            &mut current_path,
            &mut routes,
            min_profit_threshold,
        );
        
        routes
    }

    fn dfs(
        &self,
        current_token: &str,
        start_token: &str,
        current_rate: f64,
        remaining_hops: usize,
        path: &mut Vec<SwapStep>,
        routes: &mut Vec<Route>,
        min_profit: f64,
    ) {
        if remaining_hops == 0 {
            return;
        }

        if let Some(edges) = self.adj.get(current_token) {
            for (next_token, pool_idx) in edges {
                let pool = &self.pools[*pool_idx];
                
                // Calculate rate for this step
                let step_rate = if next_token == &pool.token1 {
                    pool.price // token0 -> token1
                } else {
                    1.0 / pool.price // token1 -> token0
                };

                let next_rate = current_rate * step_rate;
                
                let step = SwapStep {
                    pool: pool.address.clone(),
                    token_in: current_token.to_string(),
                    token_out: next_token.clone(),
                    protocol: pool.protocol.clone(),
                    fee: pool.fee,
                    rate: step_rate,
                };

                path.push(step);

                if next_token == start_token {
                    if next_rate > 1.0 + min_profit {
                        routes.push(Route {
                            steps: path.clone(),
                            expected_profit: next_rate - 1.0,
                        });
                    }
                } else if remaining_hops > 1 {
                    // Avoid cycles that don't include start_token to prevent infinite loops
                    // in a more complex version we would use a visited set
                    if !path.iter().any(|s| s.token_in == *next_token) {
                        self.dfs(
                            next_token,
                            start_token,
                            next_rate,
                            remaining_hops - 1,
                            path,
                            routes,
                            min_profit,
                        );
                    }
                }

                path.pop();
            }
        }
    }
}
