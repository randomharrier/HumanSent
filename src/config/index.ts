/**
 * Config exports
 */

export * from './product-laws';

/**
 * Environment configuration
 */
export const ENV = {
  /** Agent timezone for business hours calculation */
  timezone: process.env.AGENT_TIMEZONE || 'America/Los_Angeles',

  /** Default tick interval in minutes */
  tickIntervalMinutes: parseInt(process.env.AGENT_TICK_INTERVAL_MINUTES || '30', 10),

  /** Leadership agents tick more frequently (for Precedent testing) */
  leadershipTickIntervalMinutes: parseInt(process.env.LEADERSHIP_TICK_INTERVAL_MINUTES || '10', 10),

  /** External agents tick less frequently (they have fewer interactions) */
  externalTickIntervalMinutes: parseInt(process.env.EXTERNAL_TICK_INTERVAL_MINUTES || '60', 10),

  /** Daily action budget per agent (resets daily) */
  dailyBudget: parseInt(process.env.AGENT_DAILY_BUDGET || '250', 10),

  /** Business hours start (24h format) */
  businessHoursStart: parseInt(process.env.AGENT_BUSINESS_HOURS_START || '9', 10),

  /** Business hours end (24h format) */
  businessHoursEnd: parseInt(process.env.AGENT_BUSINESS_HOURS_END || '17', 10),

  /** Dry run mode - logs actions but doesn't execute */
  dryRunMode: process.env.DRY_RUN_MODE === 'true',

  /** 
   * Agents that are onboarded to Precedent (comma-separated agent IDs)
   * Only these agents can use the use_precedent action.
   * Example: PRECEDENT_ENABLED_AGENTS=alex,morgan,jordan
   */
  precedentEnabledAgents: (process.env.PRECEDENT_ENABLED_AGENTS || '').split(',').filter(Boolean),

  /** Disabled agents (comma-separated) */
  disabledAgents: (process.env.DISABLED_AGENTS || '').split(',').filter(Boolean),

  /** Leadership agents (tick faster, use Precedent) */
  leadershipAgents: ['alex', 'morgan', 'jordan', 'sam'] as readonly string[],

  /** External agents (tick slower) */
  externalAgents: ['chance-advisor', 'sarah-investor', 'karen-customer', 'robert-legal', 'elena-scribes'] as readonly string[],

  /** Email cooldown in minutes - minimum time between emails to the same recipient */
  emailCooldownMinutes: parseInt(process.env.EMAIL_COOLDOWN_MINUTES || '30', 10),

  /** Slack cooldown in minutes - minimum time between messages in the same channel */
  slackCooldownMinutes: parseInt(process.env.SLACK_COOLDOWN_MINUTES || '15', 10),
} as const;

/**
 * Get tick interval for a specific agent
 */
export function getTickIntervalMinutes(agentId: string): number {
  if (ENV.leadershipAgents.includes(agentId)) {
    return ENV.leadershipTickIntervalMinutes;
  }
  if (ENV.externalAgents.includes(agentId)) {
    return ENV.externalTickIntervalMinutes;
  }
  return ENV.tickIntervalMinutes;
}

/**
 * Check if current time is within business hours
 */
export function isBusinessHours(date: Date = new Date()): boolean {
  // Convert to agent timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ENV.timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';

  // Check if weekend
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false;
  }

  // Check if within business hours
  return hour >= ENV.businessHoursStart && hour < ENV.businessHoursEnd;
}

/**
 * Get day of week in agent timezone
 */
export function getDayOfWeek(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ENV.timezone,
    weekday: 'long',
  }).format(date);
}

/**
 * Check if an agent is onboarded to use Precedent
 * Only agents listed in PRECEDENT_ENABLED_AGENTS can use the use_precedent action
 */
export function canUsePrecedent(agentId: string): boolean {
  return ENV.precedentEnabledAgents.includes(agentId);
}

