/**
 * Agent action type definitions and Zod schemas
 */

import { z } from 'zod';

// ============================================
// Action Schemas (for LLM output validation)
// ============================================

export const SendEmailActionSchema = z.object({
  type: z.literal('send_email'),
  to: z.array(z.string().email()),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  conversationId: z.string().optional(),
  inReplyTo: z.string().optional(), // Gmail message ID to reply to
});

export const SendSlackMessageActionSchema = z.object({
  type: z.literal('send_slack_message'),
  channel: z.string().min(1), // Channel ID or name
  text: z.string().min(1).max(4000),
  threadTs: z.string().optional(), // Reply to thread
});

export const CreateTaskActionSchema = z.object({
  type: z.literal('create_task'),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  assignedTo: z.string(), // agent_id
  dueAt: z.string().optional(), // ISO date string
  linkedConversationId: z.string().optional(),
});

export const MarkTaskDoneActionSchema = z.object({
  type: z.literal('mark_task_done'),
  taskId: z.string().uuid(),
});

export const SnoozeTaskActionSchema = z.object({
  type: z.literal('snooze_task'),
  taskId: z.string().uuid(),
  until: z.string(), // ISO date string
});

export const UsePrecedentActionSchema = z.object({
  type: z.literal('use_precedent'),
  intent: z.enum(['briefing', 'urgent', 'situations', 'vips', 'calendar']),
  extraContext: z.string().optional(),
});

export const NoActionSchema = z.object({
  type: z.literal('no_action'),
  reason: z.string().min(1).max(500),
});

// Discriminated union of all action types
export const ActionSchema = z.discriminatedUnion('type', [
  SendEmailActionSchema,
  SendSlackMessageActionSchema,
  CreateTaskActionSchema,
  MarkTaskDoneActionSchema,
  SnoozeTaskActionSchema,
  UsePrecedentActionSchema,
  NoActionSchema,
]);

// Agent reasoning structure
export const AgentReasoningSchema = z
  .object({
    highestPriority: z.string().optional(),
    deferredItems: z.array(z.string()).optional(),
    budgetAssessment: z.string().optional(),
    observations: z.string().optional(),
  })
  .optional();

// Memory updates for persistent agent memory
export const MemoryUpdatesSchema = z
  .object({
    // Key observations to remember for future ticks
    // e.g., "Alex seems stressed about investor meeting", "Asked about data policy - 3rd time"
    observations: z.array(z.string()).optional(),
    // Items to stop tracking (already resolved or no longer relevant)
    forget: z.array(z.string()).optional(),
  })
  .optional();

// Complete agent output schema
export const AgentOutputSchema = z.object({
  reasoning: AgentReasoningSchema,
  actions: z.array(ActionSchema),
  // Memory updates to persist across ticks
  memoryUpdates: MemoryUpdatesSchema,
});

// ============================================
// TypeScript Types (inferred from schemas)
// ============================================

export type SendEmailAction = z.infer<typeof SendEmailActionSchema>;
export type SendSlackMessageAction = z.infer<typeof SendSlackMessageActionSchema>;
export type CreateTaskAction = z.infer<typeof CreateTaskActionSchema>;
export type MarkTaskDoneAction = z.infer<typeof MarkTaskDoneActionSchema>;
export type SnoozeTaskAction = z.infer<typeof SnoozeTaskActionSchema>;
export type UsePrecedentAction = z.infer<typeof UsePrecedentActionSchema>;
export type NoAction = z.infer<typeof NoActionSchema>;

export type AgentAction = z.infer<typeof ActionSchema>;
export type AgentReasoning = z.infer<typeof AgentReasoningSchema>;
export type MemoryUpdates = z.infer<typeof MemoryUpdatesSchema>;
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

// ============================================
// Action Execution Types
// ============================================

export interface ActionResult {
  action: AgentAction;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TickResult {
  tickId: string;
  agentId: string;
  status: 'completed' | 'failed' | 'skipped';
  reasoning?: AgentReasoning;
  actionsPlanned: number;
  actionsExecuted: number;
  results: ActionResult[];
  error?: string;
  durationMs: number;
}

// ============================================
// Action Budget
// ============================================

/** Cost per action type (for budget tracking) */
export const ACTION_COSTS: Record<AgentAction['type'], number> = {
  send_email: 10,
  send_slack_message: 5,
  create_task: 3,
  mark_task_done: 1,
  snooze_task: 1,
  use_precedent: 5,
  no_action: 0,
};

/** Default daily budget per agent */
export const DEFAULT_DAILY_BUDGET = 100;

