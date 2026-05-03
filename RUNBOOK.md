# Science Compiler — Operations Runbook

This document is the on-call playbook for the Science Compiler API and web app.
It is intentionally short; deeper architecture lives in `replit.md` and
`.local/tasks/*.md`.

## Observability surface

| Surface | Where | Notes |
| --- | --- | --- |
| Liveness | `GET /api/health/live` | 200 if the process is up. Use for L4 health checks. |
| Readiness | `GET /api/health/ready` | 200 if DB **and** OpenAI are reachable; 503 otherwise (`status: "degraded"`). Set `STRICT_READINESS=false` to allow ready when `OPENAI_API_KEY` is unset (dev only). |
| Build info | `GET /api/health/version` | Returns `sha`, `builtAt`, `nodeVersion`, `env`. Drives the dashboard's release line. |
| Admin dashboard | `/admin/observability` (web) → `GET /api/admin/observability` | Charts, route table, alerts, pipeline timing, ingestion health. Auto-refreshes every 30s. |
| Errors | Sentry (if `SENTRY_DSN` set) | All uncaught errors flow through `setupSentryErrorHandler` with PII scrubbing and request-scoped tags. |
| Per-request log | API server logs | Each request emits a `request.completed` line with `requestId`, `userId`, `route`, `status`, `durationMs`, `ipHash`. |

Every API response carries an `X-Request-ID` header. Error response bodies
also include a `requestId` field. Quote that ID in any incident report.

## Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `SENTRY_DSN` | optional | Enables Sentry error capture (server). |
| `VITE_SENTRY_DSN` | optional | Enables Sentry capture in the React app. |
| `BUILD_SHA` / `BUILD_TIME` | optional | Surfaced through `/health/version` and the Sentry release tag. |
| `STRICT_READINESS` | optional | Set to `false` to allow readiness without OpenAI configured. |
| `ALERT_WEBHOOK_URL` | optional | Webhook (Slack-compatible JSON POST) for alert fired/resolved events. |
| `ALERT_EMAIL_TO` | optional | Comma-separated addresses for alert emails. Requires `SMTP_URL`. |
| `SMTP_URL` | optional | nodemailer transport URL (e.g. `smtps://user:pass@smtp.example.com:465`). |
| `ALERT_EMAIL_FROM` | optional | Override the default `From:` address. |

## Alerts

The alert checker runs every 30 seconds (`lib/alerts.ts`). Each alert kind
fires once when entering the active state and resolves when the condition
clears. Notifications are deduped by a 30-minute cooldown per `kind:event`.

| Kind | Threshold | Severity | First-look |
| --- | --- | --- | --- |
| `error_rate` | 5xx ratio > 5% over 5 min with ≥20 requests | critical | Open `/admin/observability` → "Top routes (last hour)". Find the route with the spike. Search server logs by `requestId` from the "Top failing requestIds" panel. |
| `llm_budget` | Daily LLM spend > 80% of `LLM_DAILY_CAP_USD` | warning | Check `/admin/observability` → "LLM cost (last 7 days)". If a single request burned the budget, find it in the failing-requests panel. Consider raising the cap or pausing ingestion for the day. |
| `readiness` | `/health/ready` failing for > 2 min | critical | Hit `/api/health/ready` directly to inspect `checks.db` and `checks.openai`. DB failures usually indicate the Replit Postgres is down or `DATABASE_URL` is wrong. OpenAI failures: verify `OPENAI_API_KEY` and provider status. |

Persistent alert state lives in the `alerts` table (`fired_at`,
`resolved_at`, `notified_at`). Active alerts are also surfaced at the top
of the admin dashboard.

## Tracing a failed user request

1. Ask the user (or copy from the error UI) for the **Request ID**.
2. Search the API server logs:
   `rg "<request-id>" /tmp/logs/artifactsapi-server*`
3. The `request.completed` line gives you the route, status, duration, and
   user (anonymized as `ipHash` for unauthenticated requests).
4. If the request invoked a synthesis pipeline, the per-stage timings are in
   the `pipeline_spans` table and on the dashboard's "Recent syntheses" list.
5. If `SENTRY_DSN` is configured, search Sentry by tag `request_id` for the
   stack trace with full scope (route, user, IP hash).

## Scheduled work

The ingestion scheduler fires every `INGESTION_INTERVAL_MS` (default 6h) and
records each run in `ingestion_runs`. The dashboard's "Ingestion runs" table
shows the last 20 runs and the 24-hour status counts. A run that stays in
`running` for an unreasonably long time should be cancelled via the admin UI.

## When everything looks fine but users complain

- Check the proxy / preview pane status (Replit web).
- Check `X-Request-ID` round-trips: the `customFetch` response observer
  surfaces it in the React error boundary as "Last Request ID".
- Confirm Clerk auth status — 401/403 responses still carry `requestId` so
  they show up in metrics and Sentry.
