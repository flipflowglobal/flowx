/**
 * scripts/deploy.js
 * Deploy NexusFlashReceiver to the target network.
 * Usage: npx hardhat run scripts/deploy.js --network mainnet
 */

const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// Chain-specific addresses
const ADDRESSES = {
  mainnet: {
    aavePool:          "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    uniswapV3Router:   "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    balancerVault:     "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
  },
  arbitrum: {
    aavePool:          "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    uniswapV3Router:   "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    balancerVault:     "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
  },
  hardhat: {
    aavePool:          "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    uniswapV3Router:   "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    balancerVault:     "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
  },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainName  = network.name;
  const addrs      = ADDRESSES[chainName] || ADDRESSES.hardhat;

  console.log(`\nDeploying NexusFlashReceiver to ${chainName}`);
  console.log(`  Deployer:       ${deployer.address}`);
  console.log(`  Balance:        ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);
  console.log(`  Aave Pool:      ${addrs.aavePool}`);
  console.log(`  UniV3 Router:   ${addrs.uniswapV3Router}`);
  console.log(`  Balancer Vault: ${addrs.balancerVault}`);

  const Factory  = await ethers.getContractFactory("NexusFlashReceiver");
  const contract = await Factory.deploy(
    addrs.aavePool,
    addrs.uniswapV3Router,
    addrs.balancerVault,
    { gasLimit: 3_000_000 }
  );

  await contract.waitForDeployment();
  const addr = await contract.getAddress();

  console.log(`\n✓ NexusFlashReceiver deployed: ${addr}`);
  console.log(`\nUpdate your .env file:`);
  console.log(`  FLASH_RECEIVER_ADDRESS=${addr}`);

  // Write deployment record
  const record = {
    network:   chainName,
    address:   addr,
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    aavePool:  addrs.aavePool,
  };
  const outPath = path.join(__dirname, `../deployments/${chainName}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  console.log(`\n✓ Deployment record saved: ${outPath}`);

  // Copy ABI
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/NexusFlashReceiver.sol/NexusFlashReceiver.json"
  );
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    fs.writeFileSync(
      path.join(__dirname, "../abis/NexusFlashReceiver.json"),
      JSON.stringify(artifact.abi, null, 2)
    );
    console.log("✓ ABI copied to abis/NexusFlashReceiver.json");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
