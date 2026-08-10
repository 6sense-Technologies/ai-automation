# AI Automation monorepo

Three deployable automation services share one repository so developers can own separate apps while reusing Jira, git, Mongo, and Cursor agent plumbing.

## Layout

```
apps/
  bugfix/         # Bug analyze → approve → fix (production-ready pipeline)
  feature/        # Feature/enhancement automation (scaffold)
  maintenance/    # Lint, security patches, dependency updates (scaffold)
packages/
  config/         # Env + pipeline.config.yaml loading
  errors/         # Pipeline failure taxonomy
  git/            # RepoManager (clone/checkout/push)
  http/           # Secret comparison helpers
  jira/           # Jira REST client + ADF builders
  logger/         # Pino logger factory
  mongo/          # Mongo connection, indexes, AuditLog
  pipeline-core/  # JobQueue, testRunner, branch naming helpers
  providers/      # CursorAgentRunner + report path constants
```

## Ownership

| Path | Focus | Default port | Mongo DB | Branch prefix | Jira labels |
|---|---|---|---|---|---|
| `apps/bugfix` | Bug fixes | `3000` | `ai_bugfix` | `bugfix/` | `ai-analysis-ready`, `ai-fix-delivered`, `ai-fix-failed` |
| `apps/feature` | Enhancements | `3001` | `ai_feature` | `feature/` | `ai-feature-ready`, `ai-feature-delivered`, `ai-feature-failed` |
| `apps/maintenance` | Lint / security / deps | `3002` | `ai_maintenance` | `chore/`, `security/`, `deps/` | `ai-maint-ready`, `ai-maint-delivered`, `ai-maint-failed` |

See [CODEOWNERS](../CODEOWNERS). Replace `@feature-dev` / `@maintenance-dev` with real GitHub usernames.

## Local development

From the repo root:

```bash
npm install

# each service has its own .env and pipeline.config.yaml
cp apps/bugfix/.env.example apps/bugfix/.env
cp apps/bugfix/pipeline.config.example.yaml apps/bugfix/pipeline.config.yaml
# same for feature / maintenance when those owners start

npm run dev:bugfix        # port 3000
npm run dev:feature       # port 3001
npm run dev:maintenance   # port 3002

npm test                  # all workspaces
npm run test:bugfix
npm run typecheck
```

Or target a workspace directly:

```bash
npm run dev -w @ai-auto/bugfix
npm run test -w @ai-auto/bugfix
```

## Isolation rules

1. **Separate processes** — do not merge the three Fastify apps into one process.
2. **Separate Mongo DBs** — never share `MONGODB_DB` across services.
3. **Separate secrets** — each app may use its own `WEBHOOK_SECRET` / `API_KEY` in production.
4. **Namespaced labels** — Jira Automation rules must filter by label/issue type so webhooks do not cross services.
5. **Shared packages** — put code in `packages/*` only when at least two apps need it. Keep phase orchestration, schemas, and prompts app-local.

## Shared packages cheat sheet

| Package | Import when you need… |
|---|---|
| `@ai-auto/config` | `loadEnv(defaults)`, `loadPipelineConfig`, `resolveProject` |
| `@ai-auto/logger` | `createLogger` |
| `@ai-auto/errors` | `PipelineError`, `toPipelineError`, access/agent errors |
| `@ai-auto/mongo` | `connectMongo`, `AuditLog`, `COLLECTIONS` |
| `@ai-auto/jira` | `JiraClient`, ADF helpers (`doc`, `heading`, …) |
| `@ai-auto/git` | `RepoManager` |
| `@ai-auto/providers` | `CursorAgentRunner`, `REPORT_DIR`, `withTestCommand` |
| `@ai-auto/pipeline-core` | `JobQueue`, `runTests`, `slugify`, `branchName` |
| `@ai-auto/http` | `secretMatches` |

## Webhooks

Each service exposes its own `/webhooks/jira` (and maintenance also has `/webhooks/maintenance`). Point Jira Automation (or a reverse proxy path prefix) at the matching process URL. Do not share one webhook endpoint across services.
