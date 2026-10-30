import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import handler from '../api/index'

type HttpResult = { status: number; body: Record<string, unknown> }

let requestNumber = 0
async function callApi(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
  let status = 200
  let responseBody: Record<string, unknown> = {}
  const req = {
    method,
    url,
    body,
    headers: {
      'x-forwarded-for': `198.51.100.${(requestNumber++ % 200) + 1}`,
      ...headers,
    },
  }
  const res = {
    setHeader() { return this },
    status(nextStatus: number) { status = nextStatus; return this },
    json(value: unknown) { responseBody = value as Record<string, unknown>; return this },
    end() { return this },
  }
  await handler(req as never, res as never)
  return { status, body: responseBody }
}

async function deleteAgent(agentId: string): Promise<void> {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '')
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!baseUrl || !serviceRoleKey) throw new Error('Supabase server configuration is required for cleanup.')
  const response = await fetch(`${baseUrl}/rest/v1/humanlayer_agents?agent_id=eq.${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=minimal',
    },
  })
  if (!response.ok) throw new Error(`Disposable agent cleanup failed with HTTP ${response.status}.`)
}

const ownerWallet = `0x${randomBytes(20).toString('hex')}`
let agentId: string | undefined

try {
  const registration = await callApi('POST', '/api/agents/register', {
    name: 'Spend reservation integration test',
    description: 'Disposable test record; deleted automatically.',
    owner_wallet: ownerWallet,
    supported_categories: ['Research'],
    spending_limits: {
      per_task_max: '1000000',
      daily_limit: '900000',
      total_budget: '2000000',
    },
  })
  assert.equal(registration.status, 201, 'registration must persist successfully')
  agentId = String(registration.body.agent_id)
  const apiKey = String(registration.body.api_key)
  assert.ok(apiKey.length > 10, 'registration must return an API key')

  const profile = await callApi('GET', `/api/agents/${agentId}`)
  assert.equal(profile.status, 200, 'profile must be readable in a separate request')
  assert.equal(profile.body.agent_id, agentId, 'read-after-write must return the same profile')

  const unauthorized = await callApi('POST', '/api/bounties', {
    title: 'Auth test', category: 'Research', task_type: 'Verify', reward_usdc: '0.60',
    required_workers: 1, days_until_deadline: 1,
  }, { authorization: 'Bearer invalid-key' })
  assert.equal(unauthorized.status, 401, 'invalid API keys must be rejected')

  const body = {
    title: 'Reservation concurrency test',
    description: 'Disposable test request.',
    category: 'Research',
    task_type: 'Verify',
    reward_usdc: '0.60',
    required_workers: 1,
    days_until_deadline: 1,
  }
  const makeIntent = (key: string) => callApi('POST', '/api/bounties', body, {
    authorization: `Bearer ${apiKey}`,
    'idempotency-key': key,
  })
  const [first, second] = await Promise.all([makeIntent('concurrent-a'), makeIntent('concurrent-b')])
  const created = [first, second].filter((result) => result.status === 200)
  const rejected = [first, second].filter((result) => result.status === 403)
  assert.equal(created.length, 1, 'only one concurrent request may reserve within the daily limit')
  assert.equal(rejected.length, 1, 'the concurrent over-limit request must be rejected')
  const reservation = created[0].body.reservation as Record<string, unknown>
  assert.ok(reservation.id, 'successful intent must include a persistent reservation ID')

  const successfulKey = first.status === 200 ? 'concurrent-a' : 'concurrent-b'
  const retry = await makeIntent(successfulKey)
  assert.equal(retry.status, 200, 'retry with same idempotency key must succeed')
  const retryReservation = retry.body.reservation as Record<string, unknown>
  assert.equal(retryReservation.id, reservation.id, 'retry must return the original reservation')
  assert.equal(retryReservation.replayed, true, 'retry must be marked as replayed')

  const conflict = await callApi('POST', '/api/bounties', { ...body, title: 'Different request' }, {
    authorization: `Bearer ${apiKey}`,
    'idempotency-key': successfulKey,
  })
  assert.equal(conflict.status, 409, 'reusing a key for different request data must conflict')

  console.log('Supabase registration/read-after-write, API-key auth, atomic concurrent reservation, retry, and idempotency conflict checks passed.')
} finally {
  if (agentId) await deleteAgent(agentId)
}
