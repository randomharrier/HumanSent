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

  /** Tick interval in minutes */
  tickIntervalMinutes: parseInt(process.env.AGENT_TICK_INTERVAL_MINUTES || '30', 10),

  /** Daily action budget per agent (resets daily) */
  dailyBudget: parseInt(process.env.AGENT_DAILY_BUDGET || '250', 10),

  /** Business hours start (24h format) */
  businessHoursStart: parseInt(process.env.AGENT_BUSINESS_HOURS_START || '9', 10),

  /** Business hours end (24h format) */
  businessHoursEnd: parseInt(process.env.AGENT_BUSINESS_HOURS_END || '17', 10),

  /** Dry run mode - logs actions but doesn't execute */
  dryRunMode: process.env.DRY_RUN_MODE === 'true',

  /** Enable Precedent integration */
  enablePrecedentIntegration: process.env.ENABLE_PRECEDENT_INTEGRATION !== 'false',

  /** Disabled agents (comma-separated) */
  disabledAgents: (process.env.DISABLED_AGENTS || '').split(',').filter(Boolean),
} as const;

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

