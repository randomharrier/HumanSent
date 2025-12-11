/**
 * HumanSent Agents - Inngest Setup
 *
 * Main entry point for the agent simulation system.
 */

import { serve } from 'inngest/express';
import express from 'express';
import { inngest } from './inngest-client';
import { agentTickFunction, agentTickAllFunction } from './functions/agent-tick';
import {
  // Emergency/Pressure
  karenMeltdownScenario,
  legalSubpoenaScenario,
  investorPressureScenario,
  scribeCrisisScenario,
  // Routine
  weeklyStandupScenario,
  expenseReportsScenario,
  advisorCheckinScenario,
  // Planning
  allHandsPlanningScenario,
  quarterlyReviewScenario,
  // Hiring
  interviewSchedulingScenario,
  newHireOnboardingScenario,
  // Culture
  teamOutingScenario,
  // Product
  featureLaunchScenario,
  // Positive
  customerWinScenario,
} from './functions/scenarios';

// Re-export inngest client for backward compatibility
export { inngest };

// ============================================
// All Functions
// ============================================

export const functions = [
  // Agent ticks
  agentTickFunction,
  agentTickAllFunction,

  // Emergency/Pressure scenarios
  karenMeltdownScenario,
  legalSubpoenaScenario,
  investorPressureScenario,
  scribeCrisisScenario,

  // Routine scenarios
  weeklyStandupScenario,
  expenseReportsScenario,
  advisorCheckinScenario,

  // Planning scenarios
  allHandsPlanningScenario,
  quarterlyReviewScenario,

  // Hiring scenarios
  interviewSchedulingScenario,
  newHireOnboardingScenario,

  // Culture scenarios
  teamOutingScenario,

  // Product scenarios
  featureLaunchScenario,

  // Positive scenarios
  customerWinScenario,
];

// ============================================
// Express Server
// ============================================

const app = express();

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Inngest endpoint
app.use(
  '/api/inngest',
  serve({
    client: inngest,
    functions,
  })
);

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`HumanSent Agents running on port ${PORT}`);
  console.log(`Inngest endpoint: http://localhost:${PORT}/api/inngest`);
});

export default app;

