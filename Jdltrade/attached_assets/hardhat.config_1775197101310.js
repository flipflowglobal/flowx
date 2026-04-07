require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    mainnet: {
      url:      process.env.ETH_RPC_URL || "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      gasPrice: "auto",
      timeout:  120000,
    },
    arbitrum: {
      url:      process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
      gasPrice: "auto",
      chainId:  42161,
    },
    hardhat: {
      forking: {
        url:         process.env.ETH_RPC_URL || "",
        enabled:     !!process.env.ETH_RPC_URL,
      },
      accounts: { count: 10, initialBalance: "10000000000000000000000" },
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      mainnet:     process.env.ETHERSCAN_API_KEY || "",
      arbitrumOne: process.env.ARBISCAN_API_KEY  || "",
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
};
