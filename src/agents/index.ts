/**
 * Agent persona exports and registry
 */

import type { AgentPersona } from '../types/agent';

// Leadership team
export { alex, morgan, jordan, sam } from './leadership';

// Internal support
export { taylor, riley, casey } from './internal';

// External role-players
export { chanceAdvisor, sarahInvestor, karenCustomer, robertLegal, elenaScribes } from './external';

// Import all for registry
import { alex, morgan, jordan, sam } from './leadership';
import { taylor, riley, casey } from './internal';
import { chanceAdvisor, sarahInvestor, karenCustomer, robertLegal, elenaScribes } from './external';

/**
 * All agent personas indexed by ID
 */
export const AGENTS: Record<string, AgentPersona> = {
  // Leadership (4)
  alex,
  morgan,
  jordan,
  sam,

  // Internal Support (3)
  taylor,
  riley,
  casey,

  // External Role-Players (5)
  'chance-advisor': chanceAdvisor,
  'sarah-investor': sarahInvestor,
  'karen-customer': karenCustomer,
  'robert-legal': robertLegal,
  'elena-scribes': elenaScribes,
};

/**
 * Get an agent by ID
 */
export function getAgent(agentId: string): AgentPersona | undefined {
  return AGENTS[agentId];
}

/**
 * Get all agent IDs
 */
export function getAllAgentIds(): string[] {
  return Object.keys(AGENTS);
}

/**
 * Get agents by type
 */
export function getAgentsByType(type: AgentPersona['type']): AgentPersona[] {
  return Object.values(AGENTS).filter((a) => a.type === type);
}

/**
 * Leadership team IDs (these are Precedent users)
 */
export const LEADERSHIP_IDS = ['alex', 'morgan', 'jordan', 'sam'] as const;

/**
 * Internal support IDs
 */
export const INTERNAL_IDS = ['taylor', 'riley', 'casey'] as const;

/**
 * External role-player IDs
 */
export const EXTERNAL_IDS = [
  'chance-advisor',
  'sarah-investor',
  'karen-customer',
  'robert-legal',
  'elena-scribes',
] as const;

/**
 * All agent IDs
 */
export const ALL_AGENT_IDS = [...LEADERSHIP_IDS, ...INTERNAL_IDS, ...EXTERNAL_IDS] as const;

/**
 * Shared inboxes (not agents)
 */
export const SHARED_INBOXES = ['finance@humansent.co', 'team@humansent.co'] as const;

/**
 * Get other agents (for context building)
 */
export function getOtherAgents(
  excludeId: string
): Pick<AgentPersona, 'id' | 'name' | 'role' | 'email'>[] {
  return Object.values(AGENTS)
    .filter((a) => a.id !== excludeId)
    .map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      email: a.email,
    }));
}

