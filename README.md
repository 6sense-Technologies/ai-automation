# AI Automation

Monorepo for AI-driven engineering automation:

- **`@ai-auto/bugfix`** — Jira bug analyze → approve → fix pipeline
- **`@ai-auto/feature`** — feature/enhancement automation (scaffold)
- **`@ai-auto/maintenance`** — lint, security, and dependency automation (scaffold)

## Quick start

```bash
npm install
cp apps/bugfix/.env.example apps/bugfix/.env
cp apps/bugfix/pipeline.config.example.yaml apps/bugfix/pipeline.config.yaml
# fill in secrets, then:
npm run dev:bugfix
```

Health check: `curl http://localhost:3000/healthz`

## Documentation

- [Monorepo layout & ownership](docs/monorepo.md) — how three developers work in parallel
- [Bugfix architecture & setup](docs/bug-automation-architecture.md) — full bugfix pipeline design, HTTP API, Jira setup
