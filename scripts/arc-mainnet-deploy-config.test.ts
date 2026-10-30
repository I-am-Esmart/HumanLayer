import assert from 'node:assert/strict';
import {
  ARC_MAINNET_USDC_ADDRESS,
  readArcMainnetDeploymentConfig,
  type ArcMainnetDeploymentEnv,
} from './arc-mainnet-deploy-config';

const validEnv: ArcMainnetDeploymentEnv = {
  ARC_MAINNET_RPC_URL: 'https://rpc.mainnet.arc.io',
  ARC_MAINNET_USDC_ADDRESS: ARC_MAINNET_USDC_ADDRESS,
  ARC_MAINNET_OWNER_ADDRESS: '0x5B12Ce46C7194aD57d143bC22847224047b1Ef42',
};

const cases: Array<[string, () => void]> = [
  ['accepts canonical Mainnet settings without a key in check mode', () => {
    const config = readArcMainnetDeploymentConfig(validEnv);
    assert.equal(config.rpcUrl, 'https://rpc.mainnet.arc.io');
    assert.equal(config.usdcAddress, ARC_MAINNET_USDC_ADDRESS);
    assert.equal(config.ownerAddress, '0x5B12Ce46C7194aD57d143bC22847224047b1Ef42');
    assert.equal(config.privateKey, undefined);
  }],
  ['rejects a Testnet or other USDC contract', () => {
    assert.throws(() => readArcMainnetDeploymentConfig({
      ...validEnv,
      ARC_MAINNET_USDC_ADDRESS: '0x3600000000000000000000000000000000000001',
    }), /must be Arc Mainnet USDC/);
  }],
  ['rejects a zero production owner', () => {
    assert.throws(() => readArcMainnetDeploymentConfig({
      ...validEnv,
      ARC_MAINNET_OWNER_ADDRESS: '0x0000000000000000000000000000000000000000',
    }), /cannot be the zero address/);
  }],
  ['requires a key only when broadcasting', () => {
    assert.throws(() => readArcMainnetDeploymentConfig(validEnv, { requirePrivateKey: true }), /ARC_MAINNET_PRIVATE_KEY is required/);
  }],
  ['rejects non-HTTPS RPCs', () => {
    assert.throws(() => readArcMainnetDeploymentConfig({ ...validEnv, ARC_MAINNET_RPC_URL: 'http://localhost:8545' }), /must use HTTPS/);
  }],
];

for (const [name, run] of cases) {
  run();
  console.log(`PASS ${name}`);
}

console.log(`${cases.length} Mainnet deployment configuration checks passed.`);
