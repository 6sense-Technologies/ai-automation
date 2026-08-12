# Maintenance / dependency remediation pipeline

Service: `@ai-auto/maintenance` (port **3002**, Mongo DB `ai_maintenance`).

This is a **generic remediator** — no Cursor / AI agent. It uses `npm audit`, semver rules, install/build/test, retry, revert, and PR creation.

## Flow

1. TeamPulse **Audit & remediate** → `POST /repository-issues/:id/dependency-remediation`
2. TeamPulse forwards vulns + repo to `POST /api/jobs`
3. Pipeline: clone → `npm audit` → pick safe versions (patch/minor; major only if configured) → `npm install pkg@version` → install/build/test → retry/revert → **PR only on success**
4. TeamPulse polls job status / PR URL

## Local run

```bash
cp apps/maintenance/.env.example apps/maintenance/.env
cp apps/maintenance/pipeline.config.example.yaml apps/maintenance/pipeline.config.yaml
npm run dev:maintenance
```

TeamPulse backend env:

```bash
MAINTENANCE_PIPELINE_URL=http://localhost:3002
MAINTENANCE_PIPELINE_API_KEY=<same as apps/maintenance API_KEY>
```
