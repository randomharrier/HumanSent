/**
 * Supabase service for agent state management
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AgentPersona, AgentState, AgentTask, AgentTick, EmailMessage, SlackMessage } from '../types';

// ============================================
// Client Setup
// ============================================

let supabaseClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
    }

    supabaseClient = createClient(url, key);
  }

  return supabaseClient;
}

// ============================================
// Agent State
// ============================================

export async function getAgentState(agentId: string): Promise<AgentState | null> {
  const { data, error } = await getClient()
    .from('agent_state')
    .select('*')
    .eq('agent_id', agentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }

  return transformAgentState(data);
}

export async function getAllAgentStates(): Promise<AgentState[]> {
  const { data, error } = await getClient()
    .from('agent_state')
    .select('*')
    .eq('is_active', true)
    .order('agent_id');

  if (error) throw error;

  return (data || []).map(transformAgentState);
}

export async function upsertAgentState(
  agentId: string,
  persona: AgentPersona,
  updates?: Partial<{
    lastTickAt: Date;
    lastTickId: string;
    budgetRemaining: number;
    notes: Record<string, unknown>;
    isActive: boolean;
  }>
): Promise<AgentState> {
  const { data, error } = await getClient()
    .from('agent_state')
    .upsert({
      agent_id: agentId,
      persona,
      last_tick_at: updates?.lastTickAt?.toISOString(),
      last_tick_id: updates?.lastTickId,
      budget_remaining: updates?.budgetRemaining,
      notes: updates?.notes,
      is_active: updates?.isActive ?? true,
    })
    .select()
    .single();

  if (error) throw error;

  return transformAgentState(data);
}

export async function updateAgentBudget(agentId: string, budgetRemaining: number): Promise<void> {
  const { error } = await getClient()
    .from('agent_state')
    .update({ budget_remaining: budgetRemaining })
    .eq('agent_id', agentId);

  if (error) throw error;
}

export async function resetAllBudgets(): Promise<void> {
  const { error } = await getClient()
    .from('agent_state')
    .update({
      budget_remaining: 100,
      budget_reset_at: new Date().toISOString().split('T')[0],
    })
    .eq('is_active', true);

  if (error) throw error;
}

// ============================================
// Tasks
// ============================================

export async function getOpenTasks(agentId: string): Promise<AgentTask[]> {
  const now = new Date().toISOString();

  const { data, error } = await getClient()
    .from('tasks')
    .select('*')
    .eq('agent_id', agentId)
    .or(`status.eq.open,and(status.eq.snoozed,snoozed_until.lte.${now})`)
    .order('due_at', { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data || []).map(transformTask);
}

export async function createTask(task: {
  agentId: string;
  createdBy: string;
  title: string;
  description?: string;
  dueAt?: Date;
  linkedConversationId?: string;
}): Promise<AgentTask> {
  const { data, error } = await getClient()
    .from('tasks')
    .insert({
      agent_id: task.agentId,
      created_by: task.createdBy,
      title: task.title,
      description: task.description,
      due_at: task.dueAt?.toISOString(),
      linked_conversation_id: task.linkedConversationId,
    })
    .select()
    .single();

  if (error) throw error;

  return transformTask(data);
}

export async function markTaskDone(taskId: string): Promise<void> {
  const { error } = await getClient()
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', taskId);

  if (error) throw error;
}

export async function snoozeTask(taskId: string, until: Date): Promise<void> {
  const { error } = await getClient()
    .from('tasks')
    .update({
      status: 'snoozed',
      snoozed_until: until.toISOString(),
    })
    .eq('id', taskId);

  if (error) throw error;
}

// ============================================
// Agent Actions
// ============================================

export async function logAgentAction(action: {
  agentId: string;
  tickId?: string;
  actionType: string;
  payload: Record<string, unknown>;
  reasoning?: string;
  success?: boolean;
  errorMessage?: string;
}): Promise<void> {
  const { error } = await getClient().from('agent_actions').insert({
    agent_id: action.agentId,
    tick_id: action.tickId || null,
    action_type: action.actionType,
    payload: action.payload,
    reasoning: action.reasoning,
    success: action.success ?? true,
    error_message: action.errorMessage,
  });

  if (error) throw error;
}

export async function getRecentActions(
  agentId: string,
  hours: number = 24
): Promise<
  Array<{
    id: string;
    actionType: string;
    payload: Record<string, unknown>;
    reasoning: string | null;
    createdAt: Date;
  }>
> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await getClient()
    .from('agent_actions')
    .select('id, action_type, payload, reasoning, created_at')
    .eq('agent_id', agentId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id as string,
    actionType: row.action_type as string,
    payload: row.payload as Record<string, unknown>,
    reasoning: row.reasoning as string | null,
    createdAt: new Date(row.created_at as string),
  }));
}

// ============================================
// Agent Ticks
// ============================================

export async function createTick(agentId: string): Promise<string> {
  const { data, error } = await getClient()
    .from('agent_ticks')
    .insert({ agent_id: agentId })
    .select('id')
    .single();

  if (error) throw error;

  return data.id as string;
}

export async function updateTick(
  tickId: string,
  updates: Partial<{
    status: AgentTick['status'];
    completedAt: Date;
    emailsFound: number;
    slackMessagesFound: number;
    openTasks: number;
    promptTokens: number;
    completionTokens: number;
    llmModel: string;
    llmLatencyMs: number;
    actionsPlanned: number;
    actionsExecuted: number;
    errorMessage: string;
    rawLlmResponse: string;
  }>
): Promise<void> {
  const { error } = await getClient()
    .from('agent_ticks')
    .update({
      status: updates.status,
      completed_at: updates.completedAt?.toISOString(),
      emails_found: updates.emailsFound,
      slack_messages_found: updates.slackMessagesFound,
      open_tasks: updates.openTasks,
      prompt_tokens: updates.promptTokens,
      completion_tokens: updates.completionTokens,
      llm_model: updates.llmModel,
      llm_latency_ms: updates.llmLatencyMs,
      actions_planned: updates.actionsPlanned,
      actions_executed: updates.actionsExecuted,
      error_message: updates.errorMessage,
      raw_llm_response: updates.rawLlmResponse,
    })
    .eq('id', tickId);

  if (error) throw error;
}

// ============================================
// Messages (Cache)
// ============================================

export async function upsertMessages(
  messages: Array<{
    id: string;
    conversationId?: string;
    type: 'email' | 'slack';
    fromAgent?: string;
    fromExternal?: string;
    toAgents?: string[];
    subject?: string;
    bodyPreview: string;
    fullBody?: string;
    timestamp: Date;
    isRead?: boolean;
    metadata?: Record<string, unknown>;
  }>
): Promise<void> {
  if (messages.length === 0) return;

  const rows = messages.map((m) => ({
    id: m.id,
    conversation_id: m.conversationId,
    type: m.type,
    from_agent: m.fromAgent,
    from_external: m.fromExternal,
    to_agents: m.toAgents,
    subject: m.subject,
    body_preview: m.bodyPreview,
    full_body: m.fullBody,
    timestamp: m.timestamp.toISOString(),
    is_read: m.isRead ?? false,
    metadata: m.metadata ?? {},
  }));

  const { error } = await getClient().from('messages').upsert(rows, { onConflict: 'id' });

  if (error) throw error;
}

export async function getRecentMessages(
  agentId: string,
  type?: 'email' | 'slack',
  hours: number = 48
): Promise<Array<EmailMessage | SlackMessage>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let query = getClient()
    .from('messages')
    .select('*')
    .or(`from_agent.eq.${agentId},to_agents.cs.{${agentId}}`)
    .gte('timestamp', since)
    .order('timestamp', { ascending: false });

  if (type) {
    query = query.eq('type', type);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data || []).map((row) => {
    if (row.type === 'email') {
      return {
        id: row.id,
        threadId: row.conversation_id || row.id,
        from: row.from_agent
          ? `${row.from_agent}@humansent.co`
          : (row.from_external as string) || 'unknown',
        to: (row.to_agents as string[])?.map((a) => `${a}@humansent.co`) || [],
        subject: row.subject || '',
        bodyPreview: row.body_preview || '',
        fullBody: row.full_body || undefined,
        timestamp: new Date(row.timestamp as string),
        isRead: row.is_read as boolean,
      } as EmailMessage;
    } else {
      return {
        ts: row.id,
        threadTs: row.conversation_id || undefined,
        channel: (row.metadata as Record<string, unknown>)?.channel as string || '',
        channelName: (row.metadata as Record<string, unknown>)?.channelName as string || undefined,
        userId: row.from_agent || (row.from_external as string) || '',
        text: row.body_preview || '',
        timestamp: new Date(row.timestamp as string),
        isThreadReply: !!row.conversation_id,
      } as SlackMessage;
    }
  });
}

// ============================================
// Scenarios
// ============================================

export async function updateScenarioStatus(
  scenarioId: string,
  status: 'active' | 'completed' | 'cancelled',
  notes?: string
): Promise<void> {
  const updates: Record<string, unknown> = { status };

  if (status === 'active') {
    updates.started_at = new Date().toISOString();
  } else if (status === 'completed' || status === 'cancelled') {
    updates.completed_at = new Date().toISOString();
    if (notes) updates.outcome_notes = notes;
  }

  const { error } = await getClient().from('scenarios').update(updates).eq('id', scenarioId);

  if (error) throw error;
}

// ============================================
// Gmail Sync State
// ============================================

export async function getGmailSyncState(
  agentId: string
): Promise<{ lastHistoryId: string | null; lastSyncAt: Date | null } | null> {
  const { data, error } = await getClient()
    .from('gmail_sync_state')
    .select('last_history_id, last_sync_at')
    .eq('agent_id', agentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return {
    lastHistoryId: data.last_history_id as string | null,
    lastSyncAt: data.last_sync_at ? new Date(data.last_sync_at as string) : null,
  };
}

export async function updateGmailSyncState(
  agentId: string,
  historyId: string
): Promise<void> {
  const { error } = await getClient().from('gmail_sync_state').upsert({
    agent_id: agentId,
    last_history_id: historyId,
    last_sync_at: new Date().toISOString(),
  });

  if (error) throw error;
}

// ============================================
// Helpers
// ============================================

function transformAgentState(row: Record<string, unknown>): AgentState {
  return {
    agentId: row.agent_id as string,
    persona: row.persona as AgentPersona,
    lastTickAt: row.last_tick_at ? new Date(row.last_tick_at as string) : null,
    lastTickId: row.last_tick_id as string | null,
    budgetRemaining: row.budget_remaining as number,
    budgetResetAt: new Date(row.budget_reset_at as string),
    notes: (row.notes as Record<string, unknown>) || {},
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function transformTask(row: Record<string, unknown>): AgentTask {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    createdBy: row.created_by as string,
    title: row.title as string,
    description: row.description as string | null,
    status: row.status as AgentTask['status'],
    snoozedUntil: row.snoozed_until ? new Date(row.snoozed_until as string) : null,
    dueAt: row.due_at ? new Date(row.due_at as string) : null,
    linkedConversationId: row.linked_conversation_id as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

