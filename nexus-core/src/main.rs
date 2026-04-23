mod executor;

use std::str::FromStr;

#[tokio::main]
pub async fn main() -> eyre::Result<()> {
    let rpc_url = "https://reth-ethereum.ithaca.xyz/rpc";
    let private_key = "0x0000000000000000000000000000000000000000000000000000000000000001"; // Placeholder
    let receiver_address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH address as a placeholder

    let executor = executor::Executor::new(rpc_url, private_key, receiver_address);

    // Placeholder for actual swap steps
    let steps = vec![];
    let encoded_steps = executor.encode_steps(steps);

    let asset = alloy::primitives::Address::from_str("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2").unwrap();
    let amount = alloy::primitives::U256::from(1000000000000000000u64); // 1 WETH

    let tx_hash = executor.initiate_flash_loan(asset, amount, encoded_steps).await?;

    println!("Flash loan initiated with transaction hash: {}", tx_hash);

    Ok(())
}
