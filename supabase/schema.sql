-- ============================================
-- HumanSent Agents - Database Schema
-- ============================================
-- Run this against your Supabase project to set up the database.
-- 
-- Usage:
--   1. Create a new Supabase project
--   2. Go to SQL Editor
--   3. Paste and run this entire file
-- ============================================

-- ============================================
-- AGENT STATE
-- ============================================

-- Core agent state between ticks
create table if not exists agent_state (
  agent_id text primary key,
  persona jsonb not null,           -- full persona definition
  last_tick_at timestamptz,
  last_tick_id uuid,                -- reference to last tick for debugging
  budget_remaining int default 100, -- action budget per day (resets daily)
  budget_reset_at date default current_date,
  notes jsonb default '{}',         -- long-term memory/observations
  is_active boolean default true,   -- enable/disable agent
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Trigger to update updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_agent_state_updated_at
  before update on agent_state
  for each row
  execute function update_updated_at_column();

-- ============================================
-- TASKS
-- ============================================

-- Tasks agents create for themselves/others
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agent_state(agent_id),
  created_by text not null,                       -- agent_id who created
  title text not null,
  description text,
  status text default 'open' check (status in ('open', 'done', 'snoozed', 'cancelled')),
  snoozed_until timestamptz,
  due_at timestamptz,
  linked_conversation_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger update_tasks_updated_at
  before update on tasks
  for each row
  execute function update_updated_at_column();

create index if not exists idx_tasks_agent_status on tasks(agent_id, status);
create index if not exists idx_tasks_created_by on tasks(created_by);
create index if not exists idx_tasks_due_at on tasks(due_at) where status = 'open';

-- ============================================
-- ACTION LOG
-- ============================================

-- What agents actually did (for debugging/metrics)
create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agent_state(agent_id),
  tick_id uuid,                      -- group actions by tick
  action_type text not null,         -- send_email, send_slack, create_task, etc.
  payload jsonb not null,            -- full action details
  reasoning text,                    -- why the agent did this (from LLM)
  success boolean default true,      -- did the action execute successfully?
  error_message text,                -- if failed, what was the error?
  created_at timestamptz default now()
);

create index if not exists idx_actions_agent_created on agent_actions(agent_id, created_at desc);
create index if not exists idx_actions_tick on agent_actions(tick_id);
create index if not exists idx_actions_type on agent_actions(action_type);

-- ============================================
-- TICK LOG
-- ============================================

-- Track each agent tick execution
create table if not exists agent_ticks (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agent_state(agent_id),
  started_at timestamptz default now(),
  completed_at timestamptz,
  status text default 'running' check (status in ('running', 'completed', 'failed', 'skipped')),
  
  -- Context gathered
  emails_found int default 0,
  slack_messages_found int default 0,
  open_tasks int default 0,
  
  -- LLM interaction
  prompt_tokens int,
  completion_tokens int,
  llm_model text,
  llm_latency_ms int,
  
  -- Actions taken
  actions_planned int default 0,
  actions_executed int default 0,
  
  -- Debugging
  error_message text,
  raw_llm_response text,
  
  created_at timestamptz default now()
);

create index if not exists idx_ticks_agent_created on agent_ticks(agent_id, created_at desc);
create index if not exists idx_ticks_status on agent_ticks(status);

-- ============================================
-- CONVERSATIONS
-- ============================================

-- Track email/slack threads for context continuity
create table if not exists conversations (
  id text primary key,               -- gmail thread_id or slack thread_ts
  type text not null check (type in ('email', 'slack')),
  subject text,
  participants text[],               -- agent_ids involved
  last_activity_at timestamptz,
  message_count int default 1,
  metadata jsonb default '{}',       -- channel, labels, etc.
  created_at timestamptz default now()
);

create index if not exists idx_conversations_participants on conversations using gin(participants);
create index if not exists idx_conversations_type on conversations(type);
create index if not exists idx_conversations_activity on conversations(last_activity_at desc);

-- ============================================
-- MESSAGES (for context)
-- ============================================

-- Store recent messages for agent context
-- This is a cache, not source of truth (Gmail/Slack are)
create table if not exists messages (
  id text primary key,               -- gmail message_id or slack message_ts
  conversation_id text references conversations(id),
  type text not null check (type in ('email', 'slack')),
  from_agent text,                   -- agent_id if from an agent
  from_external text,                -- email/name if external
  to_agents text[],                  -- agent_ids in to/cc
  subject text,
  body_preview text,                 -- first 500 chars
  full_body text,                    -- full content
  timestamp timestamptz not null,
  is_read boolean default false,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_messages_conversation on messages(conversation_id);
create index if not exists idx_messages_from_agent on messages(from_agent);
create index if not exists idx_messages_timestamp on messages(timestamp desc);

-- ============================================
-- SCENARIOS
-- ============================================

-- Track scenario seeds and their outcomes
create table if not exists scenarios (
  id text primary key,               -- 'karen-meltdown', 'legal-subpoena'
  name text not null,
  description text,
  status text default 'pending' check (status in ('pending', 'active', 'completed', 'cancelled')),
  seed_event jsonb,                  -- what was injected
  trigger_agent text,                -- which agent started it
  started_at timestamptz,
  completed_at timestamptz,
  outcome_notes text,
  created_at timestamptz default now()
);

create index if not exists idx_scenarios_status on scenarios(status);

-- ============================================
-- GMAIL SYNC STATE
-- ============================================

-- Track Gmail sync state per agent
create table if not exists gmail_sync_state (
  agent_id text primary key references agent_state(agent_id),
  last_history_id text,              -- Gmail history ID for incremental sync
  last_sync_at timestamptz,
  sync_errors int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger update_gmail_sync_updated_at
  before update on gmail_sync_state
  for each row
  execute function update_updated_at_column();

-- ============================================
-- SLACK SYNC STATE
-- ============================================

-- Track Slack sync state per channel
create table if not exists slack_sync_state (
  channel_id text primary key,
  channel_name text,
  last_message_ts text,              -- Last message timestamp for incremental sync
  last_sync_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger update_slack_sync_updated_at
  before update on slack_sync_state
  for each row
  execute function update_updated_at_column();

-- ============================================
-- VIEWS
-- ============================================

-- Recent actions by agent (for debugging)
create or replace view recent_agent_activity as
select 
  a.agent_id,
  a.action_type,
  a.payload->>'to' as email_to,
  a.payload->>'subject' as email_subject,
  a.payload->>'channel' as slack_channel,
  a.reasoning,
  a.success,
  a.created_at
from agent_actions a
where a.created_at > now() - interval '24 hours'
order by a.created_at desc;

-- Agent status summary
create or replace view agent_status_summary as
select 
  s.agent_id,
  s.persona->>'name' as name,
  s.persona->>'role' as role,
  s.is_active,
  s.last_tick_at,
  s.budget_remaining,
  (select count(*) from tasks t where t.agent_id = s.agent_id and t.status = 'open') as open_tasks,
  (select count(*) from agent_actions a where a.agent_id = s.agent_id and a.created_at > now() - interval '24 hours') as actions_24h
from agent_state s
order by s.agent_id;

-- Active scenarios
create or replace view active_scenarios as
select 
  id,
  name,
  status,
  started_at,
  extract(epoch from (now() - started_at))/3600 as hours_active
from scenarios
where status = 'active'
order by started_at;

-- ============================================
-- ROW LEVEL SECURITY (optional)
-- ============================================

-- Enable RLS on all tables (optional, for multi-tenant use)
-- alter table agent_state enable row level security;
-- alter table tasks enable row level security;
-- alter table agent_actions enable row level security;
-- etc.

-- ============================================
-- INITIAL DATA
-- ============================================

-- Note: Agent personas are inserted by the application on startup
-- This ensures the code is the source of truth for persona definitions

-- Insert placeholder for scenario catalog
insert into scenarios (id, name, description, status) values
  ('karen-meltdown', 'Karen Meltdown', 'Customer escalation about photo camera issue', 'pending'),
  ('legal-subpoena', 'Legal Subpoena', 'Compliance pressure about customer data', 'pending'),
  ('investor-pressure', 'Investor Pressure', 'Board deck deadline and metrics request', 'pending'),
  ('scribe-capacity-crisis', 'Scribe Capacity Crisis', 'Operational stress from sick scribes', 'pending'),
  ('acme-feature-request', 'Acme Feature Request', 'Enterprise client pressure for faster delivery', 'pending')
on conflict (id) do nothing;

