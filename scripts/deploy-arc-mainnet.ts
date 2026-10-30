import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arc } from 'viem/chains';
import {
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_USDC_ADDRESS,
  ARC_TESTNET_HUMANLAYER_ADDRESS,
  readArcMainnetDeploymentConfig,
} from './arc-mainnet-deploy-config';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_PATH = path.join(ROOT, 'contracts/out/HumanLayer.sol/HumanLayer.json');
const DEFAULT_RECORD_NAME = 'arc-mainnet-HumanLayer.json';

function getRecordPath(flags: Set<string>): string {
  const recordIndex = process.argv.indexOf('--record', 2);
  if (recordIndex < 0) return path.join(ROOT, 'contracts/deployments', DEFAULT_RECORD_NAME);

  const name = process.argv[recordIndex + 1];
  if (!name || !/^arc-mainnet-HumanLayer(?:-[a-z0-9-]+)?\.json$/i.test(name)) {
    throw new Error('--record must be a versioned arc-mainnet-HumanLayer JSON filename.');
  }
  if (!flags.has('--broadcast')) {
    throw new Error('--record is only valid with --broadcast.');
  }
  return path.join(ROOT, 'contracts/deployments', name);
}

interface FoundryArtifact {
  abi: Abi;
  bytecode: { object: Hex };
}

function loadArtifact(): FoundryArtifact {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    throw new Error(`Foundry artifact is missing. Run "bun run contracts:build" first (${ARTIFACT_PATH}).`);
  }
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8')) as FoundryArtifact;
  if (!artifact.bytecode?.object || artifact.bytecode.object === '0x') {
    throw new Error('Foundry artifact has no deployment bytecode.');
  }
  const constructorInputs = artifact.abi.find((item) => item.type === 'constructor')?.inputs ?? [];
  const constructorTypes = constructorInputs.map((input) => input.type).join(',');
  if (constructorTypes !== 'address,address') {
    throw new Error(`Unexpected HumanLayer constructor (${constructorTypes}); expected address,address.`);
  }
  return artifact;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg === '--check' || arg === '--broadcast' || arg === '--record'));
  const recordIndex = args.indexOf('--record');
  const allowedArgs = new Set(['--check', '--broadcast', '--record']);
  if (recordIndex >= 0 && args[recordIndex + 1]) allowedArgs.add(args[recordIndex + 1]);
  if (args.some((arg) => !allowedArgs.has(arg))) {
    throw new Error('Unknown deployment argument. Optional record names must use --record <versioned-filename.json>.');
  }
  const outputPath = getRecordPath(flags);
  const checkOnly = flags.has('--check');
  const broadcast = flags.has('--broadcast');
  if (checkOnly === broadcast) {
    throw new Error('Choose exactly one mode: --check (read-only) or --broadcast (deploys and spends Mainnet gas). Optional: --record <versioned-filename.json>.');
  }

  const config = readArcMainnetDeploymentConfig(process.env, { requirePrivateKey: broadcast });
  const artifact = loadArtifact();
  const publicClient = createPublicClient({ chain: arc, transport: http(config.rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error(`RPC returned chain ID ${chainId}; refusing Arc Mainnet operation (expected ${ARC_MAINNET_CHAIN_ID}).`);
  }

  const usdcCode = await publicClient.getBytecode({ address: config.usdcAddress });
  if (!usdcCode || usdcCode === '0x') {
    throw new Error(`No contract bytecode found at the configured USDC address ${config.usdcAddress}.`);
  }

  console.log(JSON.stringify({
    mode: checkOnly ? 'read-only-check' : 'broadcast',
    chainId,
    rpcUrl: config.rpcUrl,
    usdcAddress: config.usdcAddress,
    ownerAddress: config.ownerAddress,
    artifactPath: path.relative(ROOT, ARTIFACT_PATH),
  }, null, 2));

  if (checkOnly) {
    console.log('Configuration check passed. No transaction was sent.');
    return;
  }

  if (fs.existsSync(outputPath)) {
    throw new Error(`A Mainnet deployment record already exists at ${path.relative(ROOT, outputPath)}. Review it before attempting another deployment.`);
  }

  if (!config.privateKey) throw new Error('Private key unexpectedly missing after broadcast validation.');
  const account = privateKeyToAccount(config.privateKey);
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error(`Deployer ${account.address} has no Arc Mainnet native USDC gas balance; no transaction was sent.`);
  }

  const walletClient = createWalletClient({ account, chain: arc, transport: http(config.rpcUrl) });
  console.log(`Deploying HumanLayer on Arc Mainnet from ${account.address} with initial owner ${config.ownerAddress}.`);
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [config.usdcAddress, config.ownerAddress],
  });
  console.log(`Deployment transaction: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error(`Deployment transaction ${hash} did not confirm successfully (status: ${receipt.status}).`);
  }
  const contractAddress = getAddress(receipt.contractAddress);
  if (contractAddress.toLowerCase() === ARC_TESTNET_HUMANLAYER_ADDRESS.toLowerCase()) {
    throw new Error('Refusing to record the known Arc Testnet contract address as a Mainnet deployment.');
  }

  const deployedCode = await publicClient.getBytecode({ address: contractAddress });
  if (!deployedCode || deployedCode === '0x') {
    throw new Error(`Deployment receipt succeeded but no code is present at ${contractAddress}. Tx: ${hash}`);
  }

  const [deployedOwner, deployedUsdc, feeRecipient, platformFeeBps, block] = await Promise.all([
    publicClient.readContract({ abi: artifact.abi, address: contractAddress, functionName: 'owner' }),
    publicClient.readContract({ abi: artifact.abi, address: contractAddress, functionName: 'usdcToken' }),
    publicClient.readContract({ abi: artifact.abi, address: contractAddress, functionName: 'feeRecipient' }),
    publicClient.readContract({ abi: artifact.abi, address: contractAddress, functionName: 'platformFeeBps' }),
    publicClient.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  if (String(deployedOwner).toLowerCase() !== config.ownerAddress.toLowerCase() ||
      String(deployedUsdc).toLowerCase() !== ARC_MAINNET_USDC_ADDRESS.toLowerCase() ||
      String(feeRecipient).toLowerCase() !== config.ownerAddress.toLowerCase() ||
      platformFeeBps !== 200n) {
    throw new Error(`Post-deployment constructor verification failed for ${contractAddress}. Review tx ${hash} before use.`);
  }

  const record = {
    contract: 'HumanLayer',
    network: 'Arc Mainnet',
    chainId,
    address: contractAddress,
    transactionHash: hash,
    deployerAddress: getAddress(account.address),
    ownerAddress: getAddress(String(deployedOwner)),
    usdcAddress: getAddress(String(deployedUsdc)),
    feeRecipient: getAddress(String(feeRecipient)),
    platformFeeBps: platformFeeBps.toString(),
    blockNumber: receipt.blockNumber.toString(),
    deployedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    explorerUrl: `https://explorer.arc.io/address/${contractAddress}`,
    transactionUrl: `https://explorer.arc.io/tx/${hash}`,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(record, null, 2));
  console.log(`Deployment record saved to ${path.relative(ROOT, outputPath)}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Arc Mainnet deployment failed.');
  process.exitCode = 1;
});
