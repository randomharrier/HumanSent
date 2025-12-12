/**
 * HumanSent Agents - Inngest Setup
 *
 * Main entry point for the agent simulation system.
 */

import { serve } from 'inngest/express';
import express from 'express';
import crypto from 'crypto';
import { inngest } from './inngest-client';
import { agentTickFunction, agentTickAllFunction } from './functions/agent-tick';
import { slackControlCommandFunction } from './functions/slack-control';
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

  // Slack control
  slackControlCommandFunction,

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

type ExpressRequestWithRawBody = express.Request & { rawBody?: Buffer };

// Body parsing middleware (required for Inngest)
// Also captures rawBody for Slack signature verification.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as ExpressRequestWithRawBody).rawBody = Buffer.from(buf);
    },
  })
);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Slack Events API (Control Channel)
// ============================================

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifySlackSignature(req: ExpressRequestWithRawBody): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return false;

  const timestamp = req.header('x-slack-request-timestamp');
  const signature = req.header('x-slack-signature');
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  // Prevent replay attacks (5 minutes)
  const ageSeconds = Math.abs(Date.now() / 1000 - ts);
  if (ageSeconds > 60 * 5) return false;

  const rawBody = req.rawBody;
  if (!rawBody) return false;

  const baseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const digest = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = `v0=${digest}`;
  return timingSafeEqual(expected, signature);
}

app.post('/api/slack/events', async (req, res) => {
  const slackReq = req as ExpressRequestWithRawBody;

  const body = req.body as unknown;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid_body' });
  }

  // URL verification (Slack challenge)
  if ((body as Record<string, unknown>).type === 'url_verification') {
    const challenge = (body as Record<string, unknown>).challenge;
    if (typeof challenge !== 'string') {
      return res.status(400).json({ error: 'invalid_challenge' });
    }
    return res.status(200).json({ challenge });
  }

  // For all other Slack requests, require signature verification.
  if (!verifySlackSignature(slackReq)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // Event callback
  if ((body as Record<string, unknown>).type === 'event_callback') {
    const eventId = (body as Record<string, unknown>).event_id;
    const event = (body as Record<string, unknown>).event;

    if (typeof eventId !== 'string' || !event || typeof event !== 'object') {
      return res.status(200).json({ ok: true });
    }

    const ev = event as Record<string, unknown>;
    if (ev.type !== 'message') {
      return res.status(200).json({ ok: true });
    }

    // Ignore bot messages + message subtypes
    if (typeof ev.bot_id === 'string' || typeof ev.subtype === 'string') {
      return res.status(200).json({ ok: true });
    }

    const channel = ev.channel;
    const user = ev.user;
    const text = ev.text;
    const ts = ev.ts;
    const threadTs = ev.thread_ts;

    if (
      typeof channel !== 'string' ||
      typeof user !== 'string' ||
      typeof text !== 'string' ||
      typeof ts !== 'string'
    ) {
      return res.status(200).json({ ok: true });
    }

    const controlChannelId = process.env.SLACK_CONTROL_CHANNEL_ID;
    if (controlChannelId && channel !== controlChannelId) {
      return res.status(200).json({ ok: true });
    }

    const allowedUserIds = (process.env.SLACK_CONTROL_ALLOWED_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedUserIds.length > 0 && !allowedUserIds.includes(user)) {
      return res.status(200).json({ ok: true });
    }

    const prefix = process.env.SLACK_CONTROL_COMMAND_PREFIX || '!hs';
    const trimmed = text.trim();
    if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      return res.status(200).json({ ok: true });
    }

    // Ack immediately; execute asynchronously in Inngest.
    res.status(200).json({ ok: true });

    try {
      await inngest.send({
        id: `slack:${eventId}`,
        name: 'slack/control.command',
        data: {
          eventId,
          channel,
          user,
          text: trimmed,
          ts,
          threadTs: typeof threadTs === 'string' ? threadTs : undefined,
        },
      });
    } catch (err) {
      // Don't fail Slack webhook response; best-effort dispatch.
      console.error('Failed to dispatch slack/control.command', err);
    }

    return;
  }

  return res.status(200).json({ ok: true });
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

