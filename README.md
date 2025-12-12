# HumanSent Agents

Autonomous AI agent simulation for testing [Precedent AI](https://precedent.ai). 11 agents simulate a seed-stage startup, creating organic email and Slack communication patterns that stress-test executive workflow tools.

## humansent.co Website

This repo also includes a tiny static marketing site (intentionally retro) under `site/`.

- **Local preview**: open `site/index.html`
- **Netlify**: configured via `netlify.toml` to publish `site/`

## Overview

**HumanSent** is a fictional startup that converts digital messages into hand-written postcards created by real humans. This unique product creates natural friction and customer tension—perfect for generating realistic executive communication patterns.

### Key Principle

Agents have **full agency**. They decide who to message, what to write, and when to act. Scenarios are seed events, not scripts. The simulation creates emergent behavior that mirrors real executive workflows.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ 1. GATHER CONTEXT                                       │
│    - Fetch unread/recent emails (Gmail API)             │
│    - Fetch recent Slack messages                        │
│    - Load open tasks from Supabase                      │
├─────────────────────────────────────────────────────────┤
│ 2. LLM DECIDES                                          │
│    - System prompt: persona, relationships, product laws│
│    - User prompt: recent events, tasks, conversations   │
│    - Output: JSON actions (or empty = do nothing)       │
├─────────────────────────────────────────────────────────┤
│ 3. EXECUTE ACTIONS                                      │
│    - send_email → Gmail API                             │
│    - send_slack_message → Slack API                     │
│    - create_task → Supabase                             │
│    - use_precedent → Post to @Precedent                 │
├─────────────────────────────────────────────────────────┤
│ 4. UPDATE STATE                                         │
│    - Log actions taken                                  │
│    - Update budget remaining                            │
│    - Save observations                                  │
└─────────────────────────────────────────────────────────┘
```

## Agents

### Leadership Team (Precedent Users)

| Agent | Role | Email |
|-------|------|-------|
| **Alex Reyes** | CEO/Founder | alex@humansent.co |
| **Morgan Kim** | COO | morgan@humansent.co |
| **Jordan Ellis** | Head of Product | jordan@humansent.co |
| **Sam Okonkwo** | Head of Engineering | sam@humansent.co |

### Internal Support

| Agent | Role | Email |
|-------|------|-------|
| **Taylor Park** | Customer Success Lead | taylor@humansent.co |
| **Riley Chen** | Senior Engineer | riley@humansent.co |
| **Casey Martinez** | Operations Coordinator | casey@humansent.co |

### External Role-Players

| Agent | Role | Email |
|-------|------|-------|
| **Chance Kelch** | Board Advisor | chance-advisor@humansent.co |
| **Sarah Chen** | Lead Investor | sarah-investor@humansent.co |
| **Karen Thornton** | Repeat Complainant | karen-customer@humansent.co |
| **Robert Kim** | Legal Counsel | robert-legal@humansent.co |

## Quick Start

### Prerequisites

1. **Google Workspace** with 13 email accounts at `@humansent.co`
2. **Slack workspace** at `humansent.slack.com`
3. **Supabase** project
4. **Anthropic** API key
5. **Railway** account (for hosting)
6. **Inngest** account (for orchestration)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/your-org/humansent-agents.git
cd humansent-agents
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment template:
```bash
cp .env.example .env
```

4. Configure environment variables (see [Environment Setup](#environment-setup))

5. Initialize Supabase:
```bash
# Go to Supabase SQL Editor and run:
# supabase/schema.sql
```

6. Deploy to Railway:
```bash
# Link to Railway project
railway link

# Deploy
railway up
```

7. Configure Inngest:
   - Add your Railway app URL to Inngest
   - Verify functions appear in Inngest dashboard

## Environment Setup

### Required Variables

```bash
# Inngest
INNGEST_EVENT_KEY=your_event_key
INNGEST_SIGNING_KEY=your_signing_key

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-key

# Gmail (Service Account)
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
```

### Google Workspace Setup

1. Create a GCP project
2. Enable Gmail API
3. Create a service account with domain-wide delegation
4. Grant the service account these scopes in Google Admin:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`

### Slack Setup

1. Create a Slack app at api.slack.com
2. Add bot token scopes:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `users:read`
   - `users:read.email`
3. Install to your workspace

## Usage

### Trigger Agent Ticks

Agent ticks run automatically every 30 minutes during business hours (9am-5pm PT, M-F).

To manually trigger all agents:
```bash
# Via Inngest dashboard, send event:
{
  "name": "agent/tick.all",
  "data": { "force": true }
}
```

To trigger a single agent:
```bash
{
  "name": "agent/tick",
  "data": { "agentId": "alex", "force": true }
}
```

### Run Scenarios

Scenarios inject seed events that agents react to organically.

**Karen Meltdown** (customer escalation):
```bash
{
  "name": "scenario/karen-meltdown",
  "data": {}
}
```

**Legal Subpoena** (compliance pressure):
```bash
{
  "name": "scenario/legal-subpoena",
  "data": {}
}
```

**Investor Pressure** (board deck deadline):
```bash
{
  "name": "scenario/investor-pressure",
  "data": { "deadline": "2025-12-13T17:00:00Z" }
}
```

### Dry Run Mode

To test without sending real emails/Slack messages:
```bash
DRY_RUN_MODE=true
```

Actions will be logged but not executed.

## HumanSent Product Laws

These constraints create natural friction and customer tension:

1. **No instant delivery.** Every message is physically mailed (4-7 days).
2. **All handwriting is real.** No fonts, no robots, no plotters.
3. **Photos must be taken live in-app.** No camera roll, no preview.
4. **Messages cannot be edited once sent.** No undo, no recall.
5. **No digital copies stored after writing.** Physical card only.

Agents will never violate these laws, even under pressure.

## Development

### Local Development

```bash
# Run with Inngest Dev Server
npm run dev
```

### Build

```bash
npm run build
```

### Type Check

```bash
npm run type-check
```

### Lint

```bash
npm run lint
```

## Monitoring

### Inngest Dashboard

All agent ticks and scenarios are visible in the Inngest dashboard with:
- Function execution history
- Step-by-step execution
- Error details
- Retry management

### Supabase Tables

- `agent_state` — Current state of each agent
- `agent_ticks` — Execution history
- `agent_actions` — All actions taken
- `tasks` — Tasks created by agents
- `scenarios` — Scenario status and outcomes

### Views

```sql
-- Recent activity
SELECT * FROM recent_agent_activity;

-- Agent status summary
SELECT * FROM agent_status_summary;

-- Active scenarios
SELECT * FROM active_scenarios;
```

## Cost Estimate

| Service | Monthly Cost |
|---------|-------------|
| Google Workspace (13 users) | ~$78 |
| Inngest Pro | ~$50 |
| Railway | ~$5-20 |
| Supabase (free tier) | $0 |
| Anthropic API | ~$20-50 |
| **Total** | **~$150-200** |

## File Structure

```
humansent-agents/
├── src/
│   ├── agents/           # 11 agent personas
│   │   ├── leadership/   # alex, morgan, jordan, sam
│   │   ├── internal/     # taylor, riley, casey
│   │   └── external/     # chance-advisor, sarah-investor, karen-customer, robert-legal
│   ├── functions/        # Inngest functions
│   │   ├── agent-tick.ts # Core tick loop
│   │   └── scenarios/    # Scenario seeds
│   ├── services/         # Gmail, Slack, LLM, Supabase
│   ├── prompts/          # System and user prompts
│   ├── config/           # Product laws, settings
│   ├── types/            # TypeScript types
│   └── index.ts          # Entry point
├── supabase/
│   └── schema.sql        # Database schema
├── docs/
│   └── setup.md          # Detailed setup guide
└── README.md
```

## License

Private - For Precedent AI testing only.

