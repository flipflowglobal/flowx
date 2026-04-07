"""
executor/flash_loan_executor.py
==============================
Production-grade Python-to-Solidity bridge for flash loan initiation.
Handles ABI encoding of SwapStep[] and construction of Aave V3 calls.
"""

import logging
from typing import Optional

from web3 import Web3
from eth_abi import encode

logger = logging.getLogger(__name__)

# Protocol IDs as defined in NexusFlashReceiver.sol
PROTOCOL_UNISWAP_V3 = 0
PROTOCOL_CURVE      = 1
PROTOCOL_BALANCER   = 2

class FlashLoanExecutor:
    """
    Constructs and signs transactions for the NexusFlashReceiver contract.
    Interfaces with private RPCs (Flashbots, BeaverBuild, etc.) for MEV protection.
    """

    def __init__(self, w3_manager, config):
        self._w3m      = w3_manager
        self._config   = config
        self._receiver = Web3.to_checksum_address(config.flash_receiver_address)
        self._private_key = config.deployer_private_key
        self._account  = w3_manager.get_connection().eth.account.from_key(self._private_key)

    # ── Encode Swap Steps ─────────────────────────────────────────────────────
    def _encode_swap_steps(self, route: list[dict]) -> bytes:
        """
        ABI-encode the list of SwapStep structs for the Solidity contract.
        
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
        """
        steps_data = []
        for step in route:
            # Map protocol string to ID
            proto_id = {
                "uniswap_v3": PROTOCOL_UNISWAP_V3,
                "curve":      PROTOCOL_CURVE,
                "balancer":   PROTOCOL_BALANCER,
            }.get(step.get("protocol", "").lower(), PROTOCOL_UNISWAP_V3)

            # Extract fields with safe defaults
            pool            = Web3.to_checksum_address(step.get("pool", "0x0000000000000000000000000000000000000000"))
            token_in        = Web3.to_checksum_address(step.get("token_in", ""))
            token_out       = Web3.to_checksum_address(step.get("token_out", ""))
            fee             = int(step.get("fee", 3000))
            min_amount_out  = int(step.get("min_amount_out", 0))
            curve_in        = int(step.get("curve_index_in", 0))
            curve_out       = int(step.get("curve_index_out", 0))
            balancer_id     = bytes.fromhex(step.get("balancer_pool_id", "0" * 64))

            steps_data.append((
                proto_id,
                pool,
                token_in,
                token_out,
                fee,
                min_amount_out,
                curve_in,
                curve_out,
                balancer_id
            ))

        # ABI-encode as tuple[] for the contract
        # (uint8,address,address,address,uint24,uint256,uint8,uint8,bytes32)[]
        encoded = encode(
            ['(uint8,address,address,address,uint24,uint256,uint8,uint8,bytes32)[]'],
            [steps_data]
        )
        return encoded

    # ── Execute Flash Loan ────────────────────────────────────────────────────
    async def execute_flash_loan(
        self,
        asset: str,
        amount_wei: int,
        route: list[dict],
        gas_price_wei: int,
    ) -> Optional[str]:
        """
        Construct, sign, and broadcast the flash loan transaction.
        """
        w3 = self._w3m.get_connection()
        receiver_contract = w3.eth.contract(
            address=self._receiver,
            # Minimal ABI for initiateFlashLoan
            abi=[{
                "inputs": [
                    {"name": "asset", "type": "address"},
                    {"name": "amount", "type": "uint256"},
                    {"name": "encodedSteps", "type": "bytes"}
                ],
                "name": "initiateFlashLoan",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            }]
        )

        encoded_steps = self._encode_swap_steps(route)
        
        try:
            # Build transaction
            nonce = w3.eth.get_transaction_count(self._account.address)
            tx = receiver_contract.functions.initiateFlashLoan(
                Web3.to_checksum_address(asset),
                amount_wei,
                encoded_steps
            ).build_transaction({
                'from':     self._account.address,
                'gas':      800_000,  # 800k units is safe for 3-4 hops
                'gasPrice': gas_price_wei,
                'nonce':    nonce,
                'chainId':  self._config.active.chain_id,
            })

            # Sign and send
            signed_tx = w3.eth.account.sign_transaction(tx, self._private_key)
            tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            logger.info(f"Flash loan initiated: {tx_hash.hex()} asset={asset} amount={amount_wei}")
            return tx_hash.hex()

        except Exception as exc:
            logger.error(f"Flash loan execution failed: {exc}")
            return None
