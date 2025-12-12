# HumanSent Agents - System Reference

Quick reference for understanding and troubleshooting the agent simulation system.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Inngest       │────▶│   Railway       │────▶│   Supabase      │
│   (Scheduler)   │     │   (Express App) │     │   (State DB)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌─────────────┐     ┌─────────────┐
            │   Slack     │     │   Gmail     │
            │   (Bot)     │     │   (API)     │
            └─────────────┘     └─────────────┘
```

## How Agent Ticks Work

1. **Inngest cron** fires every 5 minutes (`*/5 * * * *`)
2. **`agent-tick-all`** function triggers individual ticks for all 11 agents
3. Each **`agent-tick`** function:
   - Checks if agent is active and has budget
   - Checks if within business hours (9am-5pm PST)
   - Gathers context (emails, Slack messages, tasks)
   - **Syncs Slack messages to Supabase** (messages + conversations tables)
   - Sends context to **Claude LLM** for decision
   - Executes actions (send_email, send_slack_message, create_task, etc.)
   - Logs everything to Supabase

## Agents (11 total)

### Leadership (4) - Precedent Users
| ID | Name | Email | Slack Channels |
|----|------|-------|----------------|
| alex | Alex Reyes | alex@humansent.co | leadership, all-humansent, customer-escalations |
| morgan | Morgan Kim | morgan@humansent.co | leadership, operations, all-humansent |
| jordan | Jordan Ellis | jordan@humansent.co | leadership, product, customer-escalations, all-humansent |
| sam | Sam Okonkwo | sam@humansent.co | leadership, engineering, all-humansent |

### Internal Support (3)
| ID | Name | Email | Slack Channels |
|----|------|-------|----------------|
| taylor | Taylor Park | taylor@humansent.co | product, customer-escalations |
| riley | Riley Chen | riley@humansent.co | engineering |
| casey | Casey Martinez | casey@humansent.co | operations |

### External Role-Players (4)
| ID | Name | Email | Slack Channels |
|----|------|-------|----------------|
| chance-advisor | Chance Kelch | chance-advisor@humansent.co | leadership |
| sarah-investor | Sarah Chen | sarah-investor@humansent.co | (none) |
| karen-customer | Karen Thornton | karen-customer@humansent.co | (none) |
| robert-legal | Robert Kim | robert-legal@humansent.co | leadership, legal |

## Environment Variables

### Required for Agent Ticks
```bash
# Anthropic (LLM decisions)
ANTHROPIC_API_KEY=sk-ant-...

# Slack (read/write messages)
SLACK_BOT_TOKEN=xoxb-...

# Supabase (state storage)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Inngest (orchestration)
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
```

### Optional
```bash
# Gmail (email - may not be configured)
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...

# Agent behavior
AGENT_TIMEZONE=America/Los_Angeles  # Default
AGENT_BUSINESS_HOURS_START=9        # Default: 9am
AGENT_BUSINESS_HOURS_END=17         # Default: 5pm
DRY_RUN_MODE=false                  # Set true to log without executing
DISABLED_AGENTS=                    # Comma-separated agent IDs to skip
```

## Business Hours

- **Timezone:** `America/Los_Angeles` (PST/PDT)
- **Hours:** 9am - 5pm (configurable via env vars)
- **Days:** Monday - Friday only
- **Outside hours:** Agents skip ticks unless `force: true`

## Database Tables (Supabase)

| Table | Purpose |
|-------|---------|
| `agent_state` | Agent personas, budget, last tick time |
| `agent_ticks` | Log of each tick execution |
| `agent_actions` | Log of each action taken |
| `tasks` | Tasks agents create for themselves/others |
| `messages` | Cache of Slack/email messages |
| `conversations` | Slack threads and email threads |
| `slack_sync_state` | Last synced message per channel |
| `gmail_sync_state` | Last synced email per agent |
| `scenarios` | Scenario catalog and status |

## Action Costs (Budget)

| Action | Cost |
|--------|------|
| send_email | 10 |
| send_slack_message | 5 |
| create_task | 3 |
| use_precedent | 5 |
| mark_task_done | 1 |
| snooze_task | 1 |
| no_action | 0 |

Budget resets to 100 daily at midnight UTC (4pm PST).

---

## Health Check Commands

### 1. Check Business Hours
```bash
npx ts-node -e "
const { isBusinessHours, getDayOfWeek, ENV } = require('./src/config');
const now = new Date();
console.log('UTC:', now.toISOString());
console.log('Timezone:', ENV.timezone);
console.log('Day:', getDayOfWeek(now));
console.log('Business hours:', ENV.businessHoursStart + '-' + ENV.businessHoursEnd);
console.log('Is business hours?', isBusinessHours(now));
"
```

### 2. Check Agent States
```bash
source .env && curl -s "${SUPABASE_URL}/rest/v1/agent_state?select=agent_id,is_active,budget_remaining,last_tick_at&order=agent_id" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | python3 -m json.tool
```

### 3. Check Recent Ticks
```bash
source .env && curl -s "${SUPABASE_URL}/rest/v1/agent_ticks?select=agent_id,status,started_at,slack_messages_found,actions_executed,error_message&order=started_at.desc&limit=10" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | python3 -m json.tool
```

### 4. Check Recent Actions
```bash
source .env && curl -s "${SUPABASE_URL}/rest/v1/agent_actions?select=agent_id,action_type,created_at,success&order=created_at.desc&limit=10" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | python3 -m json.tool
```

### 5. Check Synced Messages
```bash
source .env && curl -s "${SUPABASE_URL}/rest/v1/messages?select=id,from_agent,body_preview,timestamp&order=timestamp.desc&limit=10" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | python3 -m json.tool
```

### 6. Check Slack Sync State
```bash
source .env && curl -s "${SUPABASE_URL}/rest/v1/slack_sync_state?select=*" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | python3 -m json.tool
```

### 7. Test Slack Bot
```bash
npx ts-node scripts/test-slack.ts
npx ts-node scripts/test-slack.ts --sync  # Also test Supabase sync
```

### 8. Test Single Agent Tick (Dry Run)
```bash
npx ts-node scripts/test-tick.ts alex
npx ts-node scripts/test-tick.ts alex --execute  # Actually execute actions
```

---

## Common Issues & Fixes

### Agents Not Running

| Symptom | Cause | Fix |
|---------|-------|-----|
| `slack_messages_found: 0` | Slack sync not working | Check SLACK_BOT_TOKEN |
| Ticks show `skipped` | Outside business hours | Wait for 9am PST or use `force: true` |
| No recent ticks | Inngest not connected | Check Railway deployment + Inngest dashboard |
| `budget_remaining: 0` | Budget exhausted | Wait for midnight UTC reset or manually reset |

### Reset Agent Budget Manually
```bash
source .env && curl -X PATCH "${SUPABASE_URL}/rest/v1/agent_state?agent_id=eq.alex" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"budget_remaining": 100}'
```

### Trigger Tick via Inngest (Force)
```bash
npx ts-node scripts/control.ts tick alex  # Single agent
npx ts-node scripts/control.ts tick       # All agents
```

### Check Scenarios
```bash
source .env && curl -s "${SUPABASE_URL}/rest/v1/scenarios?select=id,name,status&order=id" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" | python3 -m json.tool
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Express server + Inngest setup |
| `src/functions/agent-tick.ts` | Core tick logic + cron schedule |
| `src/services/slack.ts` | Slack API + sync to Supabase |
| `src/services/supabase.ts` | Database operations |
| `src/services/llm.ts` | Anthropic Claude integration |
| `src/prompts/system.ts` | Agent system prompt |
| `src/prompts/user.ts` | Context formatting for LLM |
| `src/agents/` | Agent persona definitions |
| `src/config/index.ts` | Business hours, timezone, env vars |
| `scripts/test-tick.ts` | Manual tick testing |
| `scripts/test-slack.ts` | Slack connectivity testing |
| `scripts/control.ts` | Trigger ticks/scenarios via Inngest |

---

## Quick Reference: MCP vs CLI

**Important:** The Supabase MCP tool in Cursor may be connected to a different project!

- **MCP Tool:** Connected to `grkjfgtywiouawvnpsqt.supabase.co` (Precedent)
- **HumanSent .env:** Uses `jefjvhoufmpgvmrwutmg.supabase.co`

**Always use curl commands or scripts** to query the HumanSent Supabase, not the MCP tool.

---

## Deployment

### Railway
- Auto-deploys on push to `main`
- Check logs: `railway logs` (requires login)
- URL: Check Railway dashboard

### Inngest
- Dashboard: https://app.inngest.com
- Functions should show: `agent-tick`, `agent-tick-all`, scenarios
- Cron: `*/5 * * * *` (every 5 min)

### Supabase
- Dashboard: https://supabase.com/dashboard
- Project: `jefjvhoufmpgvmrwutmg` (HumanSent)
