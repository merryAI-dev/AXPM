# Cloud deployment (connection deferred)

This directory contains deployment code, not a claim that the service is deployed. `node scripts/deploy.mjs private/deploy.json` prints a plan. `--apply` performs it. The script never launches OAuth, chooses billing, or creates credential keys.

Prepare once in the chosen project:

- Billing, Cloud Run, Cloud Build, Artifact Registry, Firestore, Firebase Auth, Storage, Secret Manager APIs.
- A private Firestore database and Storage bucket. Deploy the repository's deny-by-default client rules. Firebase Web app with Google sign-in and exact authorized domains.
- `axpm` Artifact Registry repository and a runtime service account. Grant `roles/datastore.user`, bucket-level `roles/storage.objectUser`, and per-secret `roles/secretmanager.secretAccessor`. Give the build/deploy identity Artifact Registry write and Cloud Run deployment permissions, including actAs on that runtime identity. No project Editor key is needed.
- Secret Manager secrets: TOKEN_ENCRYPTION_KEY (64 hex), CRON_SECRET (at least 32 chars); later GOOGLE_CLIENT_SECRET and ANTHROPIC_API_KEY. GOOGLE_CLIENT_ID and AGENT_MODEL go in nonsecret env. Missing model config disables the agent; missing Google consent disables Drive/Gmail/Calendar.

Copy `config.example.json` to ignored `private/deploy.json`, fill real values, inspect the printed plan, and apply when connection/deployment is resumed. Firebase public API settings are build-time values. Never copy `.env.local` into the image. The included `.dockerignore` excludes private business files and credentials.

The public Cloud Run URL serves the login page; every business API verifies a Firebase token and exact operator allowlist. `/api/worker` and `/api/cron` require the separate CRON_SECRET. Use an independent worker invocation rather than fire-and-forget promises inside a web request.

For unattended execution, run `scripts/worker.mjs` in a Cloud Run Job (include the script in the image) with `AXPM_BASE_URL`, `AXPM_WORKER_UID` and a Secret Manager CRON_SECRET reference. Configure one task, `max-retries=0`, 900-second timeout. Cloud Scheduler invokes the Cloud Run Jobs run API using a service account with `roles/run.invoker`; it does not need the CRON_SECRET. The dispatcher processes one queued job per invocation. A scheduler tick overlapping another tick is serialized by the Firestore user lock. A later tick can process another queued job. Expired execution leases become `uncertain` and are not replayed.

Google OAuth reconnect requires a project-owned Web OAuth client with the correct user type, allowed test/internal users and workspace administrator policy. The blocked built-in gcloud OAuth client is not the app client. Adding Drive scope alone does not grant folder access; `ai@mysc.co.kr` sharing and the signed-in token must both be effective. The app verifies ancestry against the saved root on each operation. Do not store the developer's ADC refresh token in the deployed container.

The worker/scheduler commands are also implemented: `node scripts/schedule-worker.mjs private/deploy.json` prints them; `--apply` deploys the dispatcher job and creates the schedule. Set `workerUid` to an actual Firebase operator UID and `schedulerServiceAccount` to a separately provisioned scheduler identity. Use `updateSchedule: true` for an existing schedule. Both Cloud Run Job retries and Scheduler delivery retries are zero; durable queued work is picked up by a future tick, while uncertain writes are held for review.

Optional folder monitoring: set `monitorWorkspace: true` for the dispatcher, and separately enable scheduled monitoring in the operator's app settings. When the queue is idle, a dispatcher tick calls `/api/cron` with `scope=workspace`, scans one page and persists its checkpoint. After a completed scan it queues an agent inspection if model credentials exist. The next worker tick executes that queued inspection. This is polling, not a Drive webhook or Kafka consumer.
