# AI Automation

Monorepo for AI-driven engineering automation:

- **`@ai-auto/bugfix`** — Jira bug analyze → approve → fix pipeline
- **`@ai-auto/feature`** — feature/enhancement automation (scaffold)
- **`@ai-auto/maintenance`** — deterministic dependency remediation (npm audit → safe version → validate → PR; no AI agent)

## Quick start

```bash
npm install
cp apps/bugfix/.env.example apps/bugfix/.env
cp apps/bugfix/pipeline.config.example.yaml apps/bugfix/pipeline.config.yaml
# fill in secrets, then:
npm run dev:bugfix

# Maintenance / dependency remediation (port 3002):
cp apps/maintenance/.env.example apps/maintenance/.env
cp apps/maintenance/pipeline.config.example.yaml apps/maintenance/pipeline.config.yaml
npm run dev:maintenance
```

Health checks:

- Bugfix: `curl http://localhost:3000/healthz`
- Maintenance: `curl http://localhost:3002/healthz`

## Documentation

- [Monorepo layout & ownership](docs/monorepo.md) — how three developers work in parallel
- [Bugfix architecture & setup](docs/bug-automation-architecture.md) — full bugfix pipeline design, HTTP API, Jira setup
- [Maintenance pipeline](docs/maintenance-pipeline.md) — dependency remediation API and TeamPulse wiring
