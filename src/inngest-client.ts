/**
 * Inngest Client
 *
 * Separated to avoid circular dependency issues.
 */

import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'humansent-agents',
  eventKey: process.env.INNGEST_EVENT_KEY,
});
