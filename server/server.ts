/**
 * Local HTTP adapter for the same HumanLayer API handler used by Vercel.
 *
 * Keeping the route implementation shared ensures local development exercises
 * persistent storage, reservation, receipt verification, and network config in
 * the same code path as deployment.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import handler from '../api/index.ts'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const PORT = Number.parseInt(process.env.API_PORT ?? '3001', 10)
const MAX_BODY_BYTES = 32 * 1024

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('REQUEST_BODY_TOO_LARGE')
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('INVALID_JSON')
  }
}

function createVercelResponse(res: ServerResponse): VercelResponse {
  let statusCode = 200
  const adapter = {
    setHeader(name: string, value: string | number | readonly string[]) {
      res.setHeader(name, value)
      return adapter
    },
    status(nextStatus: number) {
      statusCode = nextStatus
      return adapter
    },
    json(body: unknown) {
      if (res.writableEnded) return adapter
      res.statusCode = statusCode
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
      return adapter
    },
    end(body?: string) {
      if (!res.writableEnded) {
        res.statusCode = statusCode
        res.end(body)
      }
      return adapter
    },
  }
  return adapter as unknown as VercelResponse
}

const server = createServer(async (req, res) => {
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'
      ? undefined
      : await readBody(req)
    await handler({ method: req.method, url: req.url, headers: req.headers, body } as VercelRequest, createVercelResponse(res))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error.'
    const status = message === 'REQUEST_BODY_TOO_LARGE' ? 413 : message === 'INVALID_JSON' ? 400 : 500
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: status === 500 ? 'Internal server error.' : message }))
  }
})

server.listen(PORT, () => {
  console.log(`HumanLayer Agent API listening on http://localhost:${PORT}`)
})
