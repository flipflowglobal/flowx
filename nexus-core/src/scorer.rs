use rayon::prelude::*;
use rand::prelude::*;
use rand_xoshiro::Xoshiro256PlusPlus;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteStep {
    pub pool: String,
    pub rate: f64,
    pub slippage_bps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    pub expected_profit: f64,
    pub profit_std: f64,
    pub p10: f64,
    pub p50: f64,
    pub p90: f64,
    pub confidence: f64,
}

pub struct Scorer {
    pub n_samples: usize,
}

impl Scorer {
    pub fn new(n_samples: usize) -> Self {
        Scorer { n_samples }
    }

    pub fn score_route(
        &self,
        route: &[RouteStep],
        loan_amount: f64,
        gas_cost_usd: f64,
        aave_premium_bps: u32,
    ) -> SimulationResult {
        let premium = loan_amount * (aave_premium_bps as f64 / 10000.0);
        let total_cost = loan_amount + premium + gas_cost_usd;

        // Parallel Monte Carlo simulation
        let results: Vec<f64> = (0..self.n_samples)
            .into_par_iter()
            .map_init(
                || Xoshiro256PlusPlus::from_entropy(),
                |rng, _| {
                    let mut current_amount = loan_amount;
                    for step in route {
                        // Gaussian perturbation: r̃ = r * exp(ε) where ε ~ N(0, σ²)
                        // σ = slippage_bps / 10000 / sqrt(3)
                        let sigma = (step.slippage_bps as f64 / 10000.0) / 3.0_f64.sqrt();
                        let epsilon: f64 = rng.sample(rand_distr::StandardNormal);
                        let perturbed_rate = step.rate * (epsilon * sigma).exp();
                        current_amount *= perturbed_rate;
                    }
                    current_amount - total_cost
                },
            )
            .collect();

        // Calculate statistics
        let mut sorted_results = results.clone();
        sorted_results.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let mean = results.iter().sum::<f64>() / self.n_samples as f64;
        let variance = results.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / self.n_samples as f64;
        let std_dev = variance.sqrt();

        let p10 = sorted_results[(self.n_samples as f64 * 0.1) as usize];
        let p50 = sorted_results[(self.n_samples as f64 * 0.5) as usize];
        let p90 = sorted_results[(self.n_samples as f64 * 0.9) as usize];

        let positive_samples = results.iter().filter(|&&x| x > 0.0).count();
        let confidence = positive_samples as f64 / self.n_samples as f64;

        SimulationResult {
            expected_profit: mean,
            profit_std: std_dev,
            p10,
            p50,
            p90,
            confidence,
        }
    }
}
