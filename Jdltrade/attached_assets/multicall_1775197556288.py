"""
core/multicall.py
=================
Multicall3 aggregate3 batch executor.
Single eth_call regardless of batch size — eliminates N-1 round trips.

Contract: 0xcA11bde05977b3631167028862bE2a173976CA11 (all EVM chains)
Function:  aggregate3((address target, bool allowFailure, bytes callData)[])
           returns ((bool success, bytes returnData)[])

Failed individual calls return None — never crash the batch.
"""

from __future__ import annotations

import logging
from typing import Optional

from web3 import Web3
from eth_abi import encode, decode

logger = logging.getLogger(__name__)

# Multicall3.aggregate3 selector: keccak256("aggregate3((address,bool,bytes)[])")[:4]
_AGGREGATE3_SELECTOR = bytes.fromhex("82ad56cb")

_MULTICALL3_ABI = [
    {
        "inputs": [{
            "components": [
                {"name": "target",       "type": "address"},
                {"name": "allowFailure", "type": "bool"},
                {"name": "callData",     "type": "bytes"},
            ],
            "name": "calls",
            "type": "tuple[]",
        }],
        "name": "aggregate3",
        "outputs": [{
            "components": [
                {"name": "success",    "type": "bool"},
                {"name": "returnData", "type": "bytes"},
            ],
            "name": "returnData",
            "type": "tuple[]",
        }],
        "stateMutability": "payable",
        "type": "function",
    }
]


class MulticallExecutor:
    """
    Executes batched eth_calls via Multicall3.aggregate3.

    Parameters
    ----------
    w3_manager : Web3Manager
    multicall3_address : str
        Checksummed address of the Multicall3 contract.
    """

    def __init__(self, w3_manager, multicall3_address: str):
        self._w3m    = w3_manager
        self._addr   = Web3.to_checksum_address(multicall3_address)

    def multicall(
        self,
        calls: list[tuple[str, bytes]],  # (target_address, calldata)
    ) -> list[Optional[bytes]]:
        """
        Execute a batch of calls in one eth_call.

        Returns a list of the same length as `calls`.
        Each element is the raw return bytes on success, or None on failure.
        """
        if not calls:
            return []

        w3 = self._w3m.get_connection()
        contract = w3.eth.contract(address=self._addr, abi=_MULTICALL3_ABI)

        call_structs = [
            {
                "target":       Web3.to_checksum_address(addr),
                "allowFailure": True,    # never revert whole batch
                "callData":     data,
            }
            for addr, data in calls
        ]

        try:
            results = contract.functions.aggregate3(call_structs).call()
        except Exception as exc:
            logger.error(f"Multicall3 batch failed: {exc}")
            return [None] * len(calls)

        output: list[Optional[bytes]] = []
        for success, return_data in results:
            if success and return_data:
                output.append(bytes(return_data))
            else:
                output.append(None)

        logger.debug(
            f"Multicall3: {len(calls)} calls, "
            f"{sum(1 for r in output if r is not None)} succeeded"
        )
        return output

    def encode_call(self, contract_abi: list, address: str, fn_name: str, args: list) -> tuple[str, bytes]:
        """Helper: ABI-encode a single call for inclusion in a batch."""
        w3 = self._w3m.get_connection()
        c  = w3.eth.contract(
            address=Web3.to_checksum_address(address),
            abi=contract_abi,
        )
        calldata = c.encodeABI(fn_name=fn_name, args=args)
        return address, bytes.fromhex(calldata[2:] if calldata.startswith("0x") else calldata)
