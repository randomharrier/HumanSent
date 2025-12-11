/**
 * Inngest event type definitions
 */

// ============================================
// Agent Events
// ============================================

export interface AgentTickEvent {
  name: 'agent/tick';
  data: {
    agentId: string;
    /** Force tick even outside business hours */
    force?: boolean;
  };
}

export interface AgentTickAllEvent {
  name: 'agent/tick.all';
  data: {
    /** Force tick even outside business hours */
    force?: boolean;
    /** Only tick specific agents */
    agentIds?: string[];
  };
}

// ============================================
// Scenario Events
// ============================================

export interface ScenarioKarenMeltdownEvent {
  name: 'scenario/karen-meltdown';
  data: {
    /** Scenario instance ID */
    scenarioId?: string;
  };
}

export interface ScenarioLegalSubpoenaEvent {
  name: 'scenario/legal-subpoena';
  data: {
    scenarioId?: string;
  };
}

export interface ScenarioInvestorPressureEvent {
  name: 'scenario/investor-pressure';
  data: {
    scenarioId?: string;
    /** Custom deadline (ISO date) */
    deadline?: string;
  };
}

export interface ScenarioScribeCapacityCrisisEvent {
  name: 'scenario/scribe-capacity-crisis';
  data: {
    scenarioId?: string;
  };
}

export interface ScenarioAcmeFeatureRequestEvent {
  name: 'scenario/acme-feature-request';
  data: {
    scenarioId?: string;
  };
}

// ============================================
// System Events
// ============================================

export interface SystemResetBudgetsEvent {
  name: 'system/reset-budgets';
  data: Record<string, never>;
}

export interface SystemSyncGmailEvent {
  name: 'system/sync-gmail';
  data: {
    agentId?: string; // If provided, only sync this agent
  };
}

export interface SystemSyncSlackEvent {
  name: 'system/sync-slack';
  data: {
    channelId?: string; // If provided, only sync this channel
  };
}

// ============================================
// Combined Event Types
// ============================================

export type AgentEvent = AgentTickEvent | AgentTickAllEvent;

export type ScenarioEvent =
  | ScenarioKarenMeltdownEvent
  | ScenarioLegalSubpoenaEvent
  | ScenarioInvestorPressureEvent
  | ScenarioScribeCapacityCrisisEvent
  | ScenarioAcmeFeatureRequestEvent;

export type SystemEvent = SystemResetBudgetsEvent | SystemSyncGmailEvent | SystemSyncSlackEvent;

export type HumanSentEvent = AgentEvent | ScenarioEvent | SystemEvent;

// ============================================
// Event Names (for type-safe event sending)
// ============================================

export const EventNames = {
  // Agent events
  AGENT_TICK: 'agent/tick' as const,
  AGENT_TICK_ALL: 'agent/tick.all' as const,

  // Scenario events
  SCENARIO_KAREN_MELTDOWN: 'scenario/karen-meltdown' as const,
  SCENARIO_LEGAL_SUBPOENA: 'scenario/legal-subpoena' as const,
  SCENARIO_INVESTOR_PRESSURE: 'scenario/investor-pressure' as const,
  SCENARIO_SCRIBE_CAPACITY_CRISIS: 'scenario/scribe-capacity-crisis' as const,
  SCENARIO_ACME_FEATURE_REQUEST: 'scenario/acme-feature-request' as const,

  // System events
  SYSTEM_RESET_BUDGETS: 'system/reset-budgets' as const,
  SYSTEM_SYNC_GMAIL: 'system/sync-gmail' as const,
  SYSTEM_SYNC_SLACK: 'system/sync-slack' as const,
} as const;

