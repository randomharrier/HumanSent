/**
 * Agent persona and state type definitions
 */

export type AgentType = 'leadership' | 'internal' | 'external';

export interface AgentRelationship {
  agentId: string;
  type:
    | 'trusted_advisor'
    | 'direct_report'
    | 'investor'
    | 'board_member'
    | 'customer'
    | 'vendor'
    | 'peer'
    | 'legal_counsel';
  sentiment: 'positive' | 'neutral' | 'anxious' | 'wary' | 'tense';
  notes: string;
}

export interface HotButton {
  trigger: string;
  reaction: string;
}

export interface ResponsePriority {
  /** Pattern to match (e.g., 'investor', 'board', 'customer') */
  pattern: string;
  /** Expected response time (e.g., '< 1 hour', 'same day') */
  responseTime: string;
}

export interface AgentPersona {
  id: string;
  email: string;
  name: string;
  role: string;
  type: AgentType;

  /** Background story for context */
  background: string;

  /** How they communicate */
  communicationStyle: string;

  /** How they sign emails */
  signature: string;

  /** Response time expectations by contact type */
  responsePriorities: ResponsePriority[];

  /** What triggers strong reactions */
  hotButtons: HotButton[];

  /** Relationships with other agents */
  relationships: AgentRelationship[];

  /** For external agents: their goals/motivations */
  motivations?: string[];

  /** Proactive goals - things to work on when no urgent items */
  proactiveGoals?: string[];

  /** Weekly rituals - recurring activities this agent should do */
  weeklyRituals?: string[];

  /** Sample voice for LLM to emulate */
  sampleVoice: string;

  /** Additional context for the LLM */
  additionalContext?: string;
}

export interface AgentState {
  agentId: string;
  persona: AgentPersona;
  lastTickAt: Date | null;
  lastTickId: string | null;
  budgetRemaining: number;
  budgetResetAt: Date;
  notes: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTask {
  id: string;
  agentId: string;
  createdBy: string;
  title: string;
  description: string | null;
  status: 'open' | 'done' | 'snoozed' | 'cancelled';
  snoozedUntil: Date | null;
  dueAt: Date | null;
  linkedConversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTick {
  id: string;
  agentId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: 'running' | 'completed' | 'failed' | 'skipped';

  // Context gathered
  emailsFound: number;
  slackMessagesFound: number;
  openTasks: number;

  // LLM interaction
  promptTokens: number | null;
  completionTokens: number | null;
  llmModel: string | null;
  llmLatencyMs: number | null;

  // Actions taken
  actionsPlanned: number;
  actionsExecuted: number;

  // Debugging
  errorMessage: string | null;
  rawLlmResponse: string | null;
}

/**
 * Context provided to an agent for decision-making
 */
export interface AgentContext {
  agent: AgentPersona;
  state: AgentState;

  /** Recent emails (last 24-48h or unread) */
  recentEmails: EmailMessage[];

  /** Recent Slack messages from relevant channels */
  recentSlackMessages: SlackMessage[];

  /** Open tasks assigned to this agent */
  openTasks: AgentTask[];

  /** Current time context */
  currentTime: Date;
  dayOfWeek: string;
  isBusinessHours: boolean;

  /** Other agents (for relationship context) */
  otherAgents: Pick<AgentPersona, 'id' | 'name' | 'role' | 'email'>[];
}

// Re-export message types
export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyPreview: string;
  fullBody?: string;
  timestamp: Date;
  isRead: boolean;
  labels?: string[];
}

export interface SlackMessage {
  ts: string;
  threadTs?: string;
  channel: string;
  channelName?: string;
  userId: string;
  userName?: string;
  text: string;
  timestamp: Date;
  isThreadReply: boolean;
}

