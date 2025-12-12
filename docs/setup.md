# HumanSent Agents - Setup Guide

Detailed instructions for provisioning and configuring the agent simulation system.

## Table of Contents

1. [Google Workspace Setup](#google-workspace-setup)
2. [Slack Workspace Setup](#slack-workspace-setup)
3. [Supabase Setup](#supabase-setup)
4. [Inngest Setup](#inngest-setup)
5. [Railway Deployment](#railway-deployment)
6. [Initial Data Setup](#initial-data-setup)
7. [Testing the System](#testing-the-system)

---

## Google Workspace Setup

### 1. Create Google Workspace

1. Go to [Google Workspace](https://workspace.google.com/)
2. Sign up for Business Starter (~$6/user/month)
3. Verify domain ownership for `humansent.co`

### 2. Create User Accounts

Create these 13 accounts:

```
# Leadership (4)
alex@humansent.co        # CEO/Founder
morgan@humansent.co      # COO
jordan@humansent.co      # Head of Product
sam@humansent.co         # Head of Engineering

# Internal Support (3)
taylor@humansent.co      # Customer Success Lead
riley@humansent.co       # Senior Engineer
casey@humansent.co       # Operations Coordinator

# External Role-Players (4)
chance-advisor@humansent.co   # Board Advisor
sarah-investor@humansent.co   # Lead Investor
karen-customer@humansent.co   # Repeat Complainant
robert-legal@humansent.co     # Legal Counsel

# Shared Inboxes (2)
finance@humansent.co     # Finance inbox
team@humansent.co        # All-hands distribution
```

### 3. Create GCP Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project: `humansent-agents`
3. Enable APIs:
   - Gmail API
   - Google Calendar API (if needed later)

### 4. Create Service Account

1. Go to IAM & Admin → Service Accounts
2. Create service account:
   - Name: `humansent-agent-sa`
   - Description: `Service account for agent email access`
3. Create key (JSON) and download

### 5. Enable Domain-Wide Delegation

1. In GCP, go to the service account
2. Click "Show Domain-Wide Delegation"
3. Enable delegation and note the Client ID

4. In Google Admin Console:
   - Go to Security → API Controls → Domain-wide Delegation
   - Add new client
   - Client ID: (from step 3)
   - Scopes:
     ```
     https://www.googleapis.com/auth/gmail.readonly
     https://www.googleapis.com/auth/gmail.send
     https://www.googleapis.com/auth/gmail.modify
     ```

### 6. Configure Environment Variables

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=humansent-agent-sa@humansent-agents.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

---

## Slack Workspace Setup

### 1. Create Workspace

1. Go to [Slack](https://slack.com/)
2. Create workspace: `humansent.slack.com`

### 2. Invite Users

Add all agents to the workspace (using their @humansent.co emails).

### 3. Create Channels

Create these channels:

| Channel | Purpose | Members |
|---------|---------|---------|
| `#leadership` | Leadership coordination | alex, morgan, jordan, sam |
| `#engineering` | Technical discussions | sam, riley |
| `#operations` | Fulfillment, scribes | morgan, casey |
| `#product` | Product decisions | jordan, taylor |
| `#customer-escalations` | Urgent customer issues | jordan, taylor, alex |
| `#all-humansent` | Announcements | Everyone |
| `#random` | Water cooler | Everyone |

### 4. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create New App → From scratch
3. App Name: `HumanSent Agent Bot`
4. Workspace: `humansent.slack.com`

### 5. Configure Bot Scopes

Under OAuth & Permissions, add these Bot Token Scopes:

```
channels:history
channels:read
chat:write
chat:write.customize
groups:history
groups:read
im:history
im:read
im:write
users:read
users:read.email
```

### 6. Install App to Workspace

1. Click "Install to Workspace"
2. Authorize the requested permissions
3. Copy the Bot User OAuth Token (`xoxb-...`)

### 7. Configure Environment Variables

```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret

# Slack Control Channel (recommended)
# Create a private channel (e.g. #agent-control), invite the bot, then copy the Channel ID.
SLACK_CONTROL_CHANNEL_ID=C0123456789
# Allowlist who can issue commands (Slack Member IDs, comma-separated)
SLACK_CONTROL_ALLOWED_USER_IDS=U0123456789
# Command prefix to listen for in the control channel
SLACK_CONTROL_COMMAND_PREFIX=!hs
# After triggering a scenario, auto-trigger `agent/tick.all` so agents react immediately
SLACK_CONTROL_AUTOTICK_AFTER_SCENARIO=true
```

### 8. Invite Bot to Channels

In Slack, invite the bot to each channel:
```
/invite @HumanSent Agent Bot
```

### 9. Enable Slack Events (for Slack-based control)

In Slack App settings → **Event Subscriptions**:

1. Toggle **Enable Events** on
2. Set **Request URL** to:
   - `https://<your-railway-domain>/api/slack/events`
3. Under **Subscribe to bot events**, add:
   - `message.groups` (required for private control channels)
   - `message.channels` (optional if you want a public control channel)
4. Save changes and reinstall the app if Slack prompts you

### 10. Use the control channel

In your private control channel (e.g. `#agent-control`):

- `!hs help` — list all commands
- `!hs health` — check API + Supabase connectivity
- `!hs status` — show current runtime state (active/inactive agents, dry run mode)
- `!hs tick` — trigger all agents immediately
- `!hs tick alex` — tick one agent
- `!hs pause` / `!hs resume` — pause/resume agents (DB-backed)
- `!hs budget reset all` / `!hs budget reset alex` — reset budgets
- `!hs scenarios` / `!hs scenario <name>` — list/trigger scenarios

---

## Supabase Setup

### 1. Create Project

1. Go to [Supabase](https://supabase.com/)
2. Create new project: `humansent-agents`
3. Note the project URL and service role key

### 2. Run Schema

1. Go to SQL Editor in Supabase dashboard
2. Copy contents of `supabase/schema.sql`
3. Run the query

### 3. Verify Tables

Check that these tables exist:
- `agent_state`
- `tasks`
- `agent_actions`
- `agent_ticks`
- `conversations`
- `messages`
- `scenarios`
- `gmail_sync_state`
- `slack_sync_state`

### 4. Configure Environment Variables

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Inngest Setup

### 1. Create Account

1. Go to [Inngest](https://www.inngest.com/)
2. Sign up for an account
3. Create a new project

### 2. Get Credentials

In Inngest dashboard:
1. Go to your app settings
2. Copy Event Key and Signing Key

### 3. Configure Environment Variables

```bash
INNGEST_EVENT_KEY=your-event-key
INNGEST_SIGNING_KEY=your-signing-key
```

---

## Railway Deployment

### 1. Create Account

1. Go to [Railway](https://railway.app/)
2. Sign up and create a new project

### 2. Connect Repository

1. Connect your GitHub repository
2. Railway will auto-detect the Node.js project

### 3. Configure Environment Variables

In Railway dashboard, add all environment variables:
- All `GOOGLE_*` variables
- All `SLACK_*` variables
- All `SUPABASE_*` variables
- All `INNGEST_*` variables
- `ANTHROPIC_API_KEY`
- `AGENT_TIMEZONE=America/Los_Angeles`

### 4. Configure Build

Railway should auto-detect, but verify:
- Build Command: `npm run build`
- Start Command: `npm start`

### 5. Deploy

Railway will auto-deploy on push. Verify the deployment URL.

### 6. Connect Inngest

1. In Inngest dashboard, go to your app
2. Add your Railway URL: `https://your-app.railway.app/api/inngest`
3. Inngest will verify the connection

---

## Initial Data Setup

### 1. Initialize Agent States

The system will auto-initialize agent states on first tick, but you can pre-populate:

```sql
-- Run in Supabase SQL Editor
INSERT INTO agent_state (agent_id, persona, budget_remaining, is_active)
SELECT id, persona, 100, true
FROM (
  VALUES 
    ('alex', '{"id":"alex","name":"Alex Reyes"}'::jsonb),
    ('morgan', '{"id":"morgan","name":"Morgan Kim"}'::jsonb),
    ('jordan', '{"id":"jordan","name":"Jordan Ellis"}'::jsonb),
    ('sam', '{"id":"sam","name":"Sam Okonkwo"}'::jsonb),
    ('taylor', '{"id":"taylor","name":"Taylor Park"}'::jsonb),
    ('riley', '{"id":"riley","name":"Riley Chen"}'::jsonb),
    ('casey', '{"id":"casey","name":"Casey Martinez"}'::jsonb),
    ('chance-advisor', '{"id":"chance-advisor","name":"Chance Kelch"}'::jsonb),
    ('sarah-investor', '{"id":"sarah-investor","name":"Sarah Chen"}'::jsonb),
    ('karen-customer', '{"id":"karen-customer","name":"Karen Thornton"}'::jsonb),
    ('robert-legal', '{"id":"robert-legal","name":"Robert Kim"}'::jsonb)
) AS t(id, persona)
ON CONFLICT (agent_id) DO NOTHING;
```

### 2. Verify Scenarios

Check that scenario records exist:

```sql
SELECT * FROM scenarios;
```

---

## Testing the System

### 1. Test in Dry Run Mode

Set `DRY_RUN_MODE=true` in Railway environment variables.

### 2. Trigger Test Tick

In Inngest dashboard, send event:

```json
{
  "name": "agent/tick",
  "data": {
    "agentId": "alex",
    "force": true
  }
}
```

### 3. Verify Execution

1. Check Inngest dashboard for function execution
2. Check Supabase `agent_ticks` table for tick record
3. Check Supabase `agent_actions` table for logged actions

### 4. Test Scenario

Send scenario event:

```json
{
  "name": "scenario/karen-meltdown",
  "data": {}
}
```

### 5. Disable Dry Run

Once verified, set `DRY_RUN_MODE=false` to enable real email/Slack.

### 6. Monitor

- Watch Inngest dashboard for tick executions
- Check `agent_status_summary` view for agent health
- Monitor `recent_agent_activity` view for actions

---

## Troubleshooting

### Gmail API Errors

- Verify service account has domain-wide delegation
- Verify scopes are correct
- Check that service account email is correct

### Slack Errors

- Verify bot is invited to channels
- Check bot token scopes
- Verify signing secret

### Agent Not Responding

- Check `agent_state.is_active` is true
- Check `agent_state.budget_remaining` > 0
- Verify business hours or use `force: true`

### LLM Errors

- Verify Anthropic API key
- Check rate limits
- Review `agent_ticks.error_message`

---

## Support

For issues with:
- **Google Workspace**: Check Google Admin Console
- **Slack**: Check api.slack.com/apps
- **Supabase**: Check Supabase dashboard logs
- **Inngest**: Check Inngest dashboard
- **Railway**: Check Railway deployment logs

