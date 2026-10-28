import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync(new URL('../api/index.ts', import.meta.url), 'utf8')
const abi = JSON.parse(readFileSync(new URL('../src/lib/humanlayer-abi.json', import.meta.url), 'utf8'))

const createBounty = abi.find((item) => item.type === 'function' && item.name === 'createBounty')
assert.ok(createBounty, 'ABI must define createBounty')

const signature = `createBounty(${createBounty.inputs.map((input) => input.type).join(',')})`
assert.equal(
  signature,
  'createBounty(uint8,bytes32,uint8,uint256,uint256)',
  'API pre-flight signature must match the checked-in contract ABI',
)

const handlerStart = api.indexOf("step: 1, action: 'createBounty'")
assert.notEqual(handlerStart, -1, 'API must include a createBounty transaction step')
const argsStart = api.indexOf('args: {', handlerStart)
const argsEnd = api.indexOf('\n        },', argsStart)
assert.ok(argsStart !== -1 && argsEnd !== -1, 'createBounty step must include an args object')
const argsBlock = api.slice(argsStart, argsEnd)
const argNames = [...argsBlock.matchAll(/^\s{10}(\w+):/gm)].map((match) => match[1])
assert.deepEqual(
  argNames,
  ['category', 'taskRef', 'requiredWorkers', 'rewardPerWorker', 'deadline'],
  'Transaction arguments must follow the ABI input order exactly',
)

console.log('createBounty API/ABI consistency checks passed.')
