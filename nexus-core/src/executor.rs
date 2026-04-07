use alloy::primitives::{Address, Bytes, U256};
use alloy::rpc::types::eth::TransactionRequest;
use alloy::providers::{Provider, ProviderBuilder};
use alloy::transports::http::reqwest::Http;
use alloy::sol_types::{sol, SolType, SolValue};
use alloy::signers::{Signer, local::PrivateKeySigner};
use std::str::FromStr;

// Define the Solidity struct for ABI encoding
sol! {
    struct SwapStep {
        uint8   protocol;
        address pool;
        address tokenIn;
        address tokenOut;
        uint24  fee;
        uint256 minAmountOut;
        uint8   curveIndexIn;
        uint8   curveIndexOut;
        bytes32 balancerPoolId;
    }

    // Define the function signature for ABI encoding
    function initiateFlashLoan(address asset, uint256 amount, bytes encodedSteps) external;
}

pub struct Executor {
    pub provider: Provider<Http<reqwest::Client>>,
    pub signer: PrivateKeySigner,
    pub receiver_address: Address,
}

impl Executor {
    pub fn new(rpc_url: &str, private_key: &str, receiver_address: &str) -> Self {
        let provider = ProviderBuilder::new().on_http(rpc_url.parse().unwrap());
        let signer = PrivateKeySigner::from_str(private_key).expect("Invalid private key");
        let receiver = Address::from_str(receiver_address).expect("Invalid receiver address");
        
        Executor {
            provider,
            signer,
            receiver_address: receiver,
        }
    }

    /// Encode the swap steps for the Solidity contract.
    pub fn encode_steps(&self, steps: Vec<SwapStep>) -> Bytes {
        let encoded = SwapStep::abi_encode_sequence(&steps);
        Bytes::from(encoded)
    }

    /// Construct and sign the flash loan transaction.
    pub async fn initiate_flash_loan(
        &self,
        asset: Address,
        amount: U256,
        encoded_steps: Bytes,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let call_data = initiateFlashLoanCall {
            asset,
            amount,
            encodedSteps: encoded_steps,
        }.abi_encode();

        let tx = TransactionRequest::default()
            .to(self.receiver_address)
            .from(self.signer.address())
            .input(call_data);

        // Sign and broadcast
        // let pending_tx = self.provider.send_transaction(tx).await?;
        // Ok(pending_tx.tx_hash().to_string())
        
        Ok("0x...hash".to_string()) // Placeholder
    }
}
