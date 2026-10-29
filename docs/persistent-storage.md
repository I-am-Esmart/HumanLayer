# Persistent Agent API storage

The deployed Vercel Agent API stores agent profiles, API-key hashes, per-agent totals and daily-spend counters in Supabase Postgres through Supabase's REST API. No additional npm package is required.

## 1. Create the database

1. Create a Supabase project in the Supabase dashboard.
2. Open **SQL Editor → New query**.
3. Copy and run the full contents of [`supabase-schema.sql`](./supabase-schema.sql).
4. In the Supabase project settings, copy the **Project URL** and the server-side **service_role** key. Do not use the public anon key for this backend.

## 2. Configure Vercel

In Vercel, open **human_layer → Settings → Environment Variables** and add:

- `SUPABASE_URL` — your Supabase Project URL, e.g. `https://<project-ref>.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY` — the Supabase server-side service-role key.

Set both variables for **Production** and **Preview** environments, then redeploy. Do not add a `VITE_` prefix. Never commit the service-role key, expose it to browser code, or paste it into GitHub. The service-role key bypasses row-level security and must remain server-only.

## 3. Verify persistence

Open `/health`. It should include `"storage":"connected"`. If it returns `not_configured`, the environment variables are missing. If it returns `unavailable`, inspect Vercel Runtime Logs and confirm the schema was run in the same Supabase project.

Register a test agent with `POST /api/agents/register`, save the returned `api_key` securely (it is shown once), then call `GET /api/agents/<agent_id>` in a separate request. The agent record should survive new serverless invocations. The database stores only the SHA-256 hash of the API key.

## What is and isn't persistent

- Agent profiles, API-key hashes, unique owner-wallet registration, profile totals and daily-spend rows are database-backed.
- The built-in demo agent is seeded idempotently on first storage use.
- Worker discovery profiles are illustrative static demo fixtures, not persistent user records.
- Rate-limit buckets remain per serverless instance.
- `POST /api/bounties` currently returns a pre-flight transaction plan and does not submit or confirm a transaction. Do not count generated plans as confirmed spending. Connect confirmed onchain transaction receipts/events to the persistent counter functions before treating financial totals as accounting-grade or enforcing hard budget limits.
- The standalone `bun run start` server in `server/server.ts` has its own in-memory store; this change targets the deployed Vercel handler in `api/index.ts`. Align the standalone server before relying on shared state in local-server mode.
