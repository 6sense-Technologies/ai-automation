# Feature pipeline — Jira Automation + local setup

## Local

```bash
cp apps/feature/.env.example apps/feature/.env   # or use existing .env
cp apps/feature/pipeline.config.example.yaml apps/feature/pipeline.config.yaml
# edit secrets, JAD repo mapping, then:
npm run dev:feature
curl http://localhost:3001/healthz
```

Forward **port 3001** (Public) in Cursor Ports, **or** run a tunnel:

```bash
cloudflared tunnel --url http://localhost:3001
```

## Jira Automation rule (separate from bugfix)

Created in project **JAD** as **`AI feature webhook`** (do not edit the Bug `Ai Automation` rule).

| Field | Value |
|---|---|
| Name | `AI feature webhook` |
| Trigger | Work item created |
| Condition (JQL) | `labels = feature-improvement` |
| Action | Send web request |
| URL | `https://<your-3001-forward-or-cloudflare>/webhooks/jira` |
| Method | POST |
| Headers | `X-Webhook-Secret: <apps/feature/.env WEBHOOK_SECRET>`, `Content-Type: application/json` |

If the public URL changes, update the rule’s webhook URL in Jira Automation (or recreate via the Automation Rule Management API).

Body:

```json
{
  "issueKey": "{{issue.key}}",
  "summary": {{issue.summary.asJsonString}},
  "description": {{issue.description.asJsonString}},
  "issueType": "{{issue.issueType.name}}",
  "priority": "{{issue.priority.name}}",
  "reporter": "{{issue.reporter.displayName}}",
  "assignee": "{{issue.assignee.displayName}}",
  "components": "",
  "labels": "{{issue.labels.asString}}",
  "attachments": []
}
```

## Test ticket

1. Create any work type in JAD.
2. Add label **`feature-improvement`** (exact).
3. Fill goal + acceptance criteria.
4. Expect `plan_queued` → Phase A → `ai-feature-ready`.
5. Approve:

```bash
export API_KEY="$(grep '^API_KEY=' apps/feature/.env | cut -d= -f2-)"
curl -X POST -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"notes":""}' \
  http://localhost:3001/api/tickets/JAD-XXXX/approve
```

## Isolation

- Bugfix: `issuetype = Bug` → :3000 / `ai_bugfix`
- Feature: `labels = feature-improvement` → :3001 / `ai_feature`
