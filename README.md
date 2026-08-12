# AI Automation

Monorepo for AI-driven engineering automation:

- **`@ai-auto/bugfix`** — Jira bug analyze → approve → fix pipeline
- **`@ai-auto/feature`** — label-triggered feature plan → approve → implement pipeline
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

Feature app (port 3001):

```bash
cp apps/feature/.env.example apps/feature/.env
cp apps/feature/pipeline.config.example.yaml apps/feature/pipeline.config.yaml
npm run dev:feature
curl http://localhost:3001/healthz
```

## Documentation

- [Monorepo layout & ownership](docs/monorepo.md) — how three developers work in parallel
- [Bugfix architecture & setup](docs/bug-automation-architecture.md) — full bugfix pipeline design, HTTP API, Jira setup
- [Feature pipeline setup](docs/feature-pipeline-setup.md) — label trigger, Jira Automation rule, approve API
