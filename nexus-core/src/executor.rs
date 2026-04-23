use alloy::primitives::{Address, Bytes, U256};
use alloy::rpc::types::eth::TransactionRequest;
use alloy::providers::{Provider, ProviderBuilder};
use alloy::transports::http::Http;
use alloy_sol_types::{sol, SolCall, SolType, SolValue};
use alloy::signers::local::PrivateKeySigner;
use alloy::network::Ethereum;
use std::str::FromStr;
use eyre::Result;

sol! {
    #[allow(missing_docs)]
    #[sol(rpc)]
    NexusFlashReceiver,
    "/home/ubuntu/project_workspace/NexusFlashReceiver.abi.json"
}

sol! {
    #[derive(Debug, PartialEq, Eq, Default)]
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
}

pub struct Executor {
    pub provider: Provider<Http<reqwest::Client>, Ethereum>,
    pub signer: PrivateKeySigner,
    pub receiver_address: Address,
}

impl Executor {
    pub fn new(rpc_url: &str, private_key: &str, receiver_address: &str) -> Self {
        let provider = ProviderBuilder::new().connect_http(rpc_url.parse().unwrap());
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
        let encoded = <alloy_sol_types::sol_data::Array<SwapStep> as SolType>::abi_encode_sequence(&steps);
        Bytes::from(encoded)
    }

    /// Construct and sign the flash loan transaction.
    pub async fn initiate_flash_loan(
        &self,
        asset: Address,
        amount: U256,
        encoded_steps: Bytes,
    ) -> Result<String> {
        let call = NexusFlashReceiver::initiateFlashLoanCall {
            asset,
            amount,
            encodedSteps: encoded_steps,
        };
        let call_data = call.abi_encode();

        let tx = TransactionRequest::default()
            .to(self.receiver_address)
            .from(self.signer.address())
            .input(call_data.into());

        // Sign and broadcast
        // let pending_tx = self.provider.send_transaction(tx).await?;
        // Ok(pending_tx.tx_hash().to_string())
        
        Ok("0x...hash".to_string()) // Placeholder
    }
}
