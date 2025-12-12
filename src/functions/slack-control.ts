/**
 * Slack Control Command Function
 *
 * Receives validated Slack control command events and triggers system actions
 * (ticks, scenarios, pause/resume) then replies in Slack.
 *
 * IMPORTANT: This path is intentionally separate from agent "memory" ingestion.
 */

import { z } from 'zod';
import { inngest } from '../inngest-client';
import { slack, db } from '../services';
import { ALL_AGENT_IDS, getAgent } from '../agents';
import { ENV } from '../config';
import { chanceAdvisor } from '../agents/external/chance-advisor';

type AgentId = (typeof ALL_AGENT_IDS)[number];

function isAgentId(value: string): value is AgentId {
  return (ALL_AGENT_IDS as readonly string[]).includes(value);
}

const SlackControlCommandEventSchema = z.object({
  eventId: z.string(),
  channel: z.string(),
  user: z.string(),
  text: z.string(),
  ts: z.string(),
  threadTs: z.string().optional(),
});

type SlackControlCommandEvent = z.infer<typeof SlackControlCommandEventSchema>;

type CommandResult = {
  ok: boolean;
  message: string;
  audit?: {
    command: string;
    args: string[];
  };
};

const SCENARIO_EVENTS: Record<
  string,
  { eventName: string; description: string; supportsArgs?: boolean }
> = {
  'karen-meltdown': {
    eventName: 'scenario/karen-meltdown',
    description: 'Customer escalation - Karen complains about photo camera issue',
  },
  'legal-subpoena': {
    eventName: 'scenario/legal-subpoena',
    description: 'Legal receives subpoena for customer data',
  },
  'investor-pressure': {
    eventName: 'scenario/investor-pressure',
    description: 'Sarah requests board deck with deadline',
    supportsArgs: true,
  },
  'scribe-crisis': {
    eventName: 'scenario/scribe-crisis',
    description: 'Multiple scribes out sick, backlog growing',
  },
  'weekly-standup': {
    eventName: 'scenario/weekly-standup',
    description: 'Monday morning - time for weekly leadership sync',
  },
  'expense-reports': {
    eventName: 'scenario/expense-reports',
    description: 'Finance reminds team expense reports are due',
  },
  'advisor-checkin': {
    eventName: 'scenario/advisor-checkin',
    description: 'Chance reaches out for monthly advisory check-in',
    supportsArgs: true,
  },
  'all-hands-planning': {
    eventName: 'scenario/all-hands-planning',
    description: 'Time to plan the monthly all-hands meeting',
  },
  'quarterly-review': {
    eventName: 'scenario/quarterly-review',
    description: 'Time for quarterly business review prep',
  },
  'interview-scheduling': {
    eventName: 'scenario/interview-scheduling',
    description: 'Strong candidate for product role needs interviews',
  },
  'new-hire-onboarding': {
    eventName: 'scenario/new-hire-onboarding',
    description: 'New engineer starting next week, need to prep',
  },
  'team-outing': {
    eventName: 'scenario/team-outing',
    description: 'Casey proposes organizing a team outing',
  },
  'feature-launch': {
    eventName: 'scenario/feature-launch',
    description: 'New feature ready to launch, need coordination',
  },
  'customer-win': {
    eventName: 'scenario/customer-win',
    description: 'Big enterprise customer signed! Celebrate and plan',
  },
};

function formatHelp(prefix: string): string {
  const scenarioList = Object.entries(SCENARIO_EVENTS)
    .map(([key, s]) => `- ${key}: ${s.description}`)
    .join('\n');

  return [
    '*HumanSent Control Commands*',
    '',
    `All commands must start with \`${prefix}\` in the control channel.`,
    '',
    '*Core*',
    `- \`${prefix} help\` — show this message`,
    `- \`${prefix} health\` — check API + Supabase connectivity`,
    `- \`${prefix} status\` — show runtime + pause state`,
    `- \`${prefix} tick\` — trigger tick for all agents (force=true)`,
    `- \`${prefix} tick <agentId>\` — trigger tick for one agent`,
    `- \`${prefix} pause\` — set all agents inactive in DB (they skip ticks)`,
    `- \`${prefix} resume\` — set all agents active in DB`,
    `- \`${prefix} budget reset all\` — reset budgets for all agents`,
    `- \`${prefix} budget reset <agentId>\` — reset one agent budget`,
    '',
    '*Scenarios*',
    `- \`${prefix} scenarios\` — list scenarios`,
    `- \`${prefix} scenario <name>\` — trigger scenario seed event`,
    `- \`${prefix} scenario advisor-checkin topic=strategy\` — example with args`,
    '',
    '*Available scenarios*',
    scenarioList,
  ].join('\n');
}

function parseKeyValueArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of args) {
    const idx = a.indexOf('=');
    if (idx <= 0) continue;
    const k = a.slice(0, idx).trim();
    const v = a.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

async function ensureAllAgentRowsExist(): Promise<void> {
  for (const agentId of ALL_AGENT_IDS) {
    const persona = getAgent(agentId);
    if (!persona) continue;
    // Ensure a row exists with default budget; keep active state if already present.
    const existing = await db.getAgentState(agentId);
    await db.upsertAgentState(agentId, persona, {
      budgetRemaining: existing?.budgetRemaining ?? 100,
      isActive: existing?.isActive ?? true,
    });
  }
}

async function setAllAgentsActiveInDb(isActive: boolean): Promise<void> {
  for (const agentId of ALL_AGENT_IDS) {
    const persona = getAgent(agentId);
    if (!persona) continue;
    await db.upsertAgentState(agentId, persona, { isActive });
  }
}

async function runCommand(text: string): Promise<CommandResult> {
  const prefix = process.env.SLACK_CONTROL_COMMAND_PREFIX || '!hs';
  const raw = text.trim();
  const withoutPrefix = raw.slice(prefix.length).trim();
  const parts = withoutPrefix.split(/\s+/).filter(Boolean);

  const cmd = (parts[0] || '').toLowerCase();
  const rest = parts.slice(1);

  if (!cmd || cmd === 'help') {
    return { ok: true, message: formatHelp(prefix), audit: { command: 'help', args: [] } };
  }

  if (cmd === 'health') {
    try {
      // Supabase connectivity check (throws if misconfigured/unreachable)
      await db.getAllAgentStates();
      return {
        ok: true,
        message: ['*HumanSent Health*', `- API: *ok*`, `- Supabase: *ok*`].join('\n'),
        audit: { command: 'health', args: [] },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: ['*HumanSent Health*', `- API: *ok*`, `- Supabase: *error*`, `\`${msg}\``].join('\n'),
        audit: { command: 'health', args: [] },
      };
    }
  }

  if (cmd === 'status') {
    // "Paused" is implemented via agent_state.is_active, but ENV can also disable agents.
    const states = await db.getAllAgentStates();
    const active = states.filter((s) => s.isActive).length;
    const inactive = states.filter((s) => !s.isActive).length;

    const envDisabled = ENV.disabledAgents.length;
    const dryRun = ENV.dryRunMode ? 'true' : 'false';

    const lines = states.map((s) => {
      const last = s.lastTickAt ? s.lastTickAt.toISOString() : 'never';
      const act = s.isActive ? 'on ' : 'off';
      const budget = String(s.budgetRemaining).padStart(3, ' ');
      return `${s.agentId.padEnd(16, ' ')}  ${act}  budget=${budget}  lastTick=${last}`;
    });

    return {
      ok: true,
      message: [
        '*HumanSent Status*',
        `- DB agents active: *${active}*`,
        `- DB agents inactive: *${inactive}*`,
        `- ENV disabled agents: *${envDisabled}* (${ENV.disabledAgents.join(', ') || 'none'})`,
        `- DRY_RUN_MODE: *${dryRun}*`,
        '',
        '```',
        ...lines,
        '```',
      ].join('\n'),
      audit: { command: 'status', args: [] },
    };
  }

  if (cmd === 'budget' || cmd === 'budgets') {
    const sub = (rest[0] || '').toLowerCase();
    if (sub !== 'reset') {
      return {
        ok: false,
        message: `❌ Unknown budget command. Try \`${prefix} budget reset all\` or \`${prefix} budget reset <agentId>\`.`,
        audit: { command: 'budget', args: rest },
      };
    }

    const target = rest[1];
    if (!target) {
      return {
        ok: false,
        message: `❌ Missing target. Try \`${prefix} budget reset all\` or \`${prefix} budget reset alex\`.`,
        audit: { command: 'budget reset', args: rest.slice(1) },
      };
    }

    if (target === 'all') {
      await ensureAllAgentRowsExist();
      await db.resetAllBudgetsAllAgents(100);
      return {
        ok: true,
        message: '✅ Reset budgets to *100* for *all agents*.',
        audit: { command: 'budget reset all', args: [] },
      };
    }

    if (!isAgentId(target)) {
      return {
        ok: false,
        message: `❌ Unknown agent \`${target}\`. Try \`${prefix} agents list\`.`,
        audit: { command: 'budget reset', args: [target] },
      };
    }

    await ensureAllAgentRowsExist();
    await db.resetAgentBudget(target, 100);
    return {
      ok: true,
      message: `✅ Reset budget to *100* for \`${target}\`.`,
      audit: { command: 'budget reset', args: [target] },
    };
  }

  if (cmd === 'tick') {
    const maybeAgent = rest[0];
    if (maybeAgent) {
      if (!isAgentId(maybeAgent)) {
        return {
          ok: false,
          message: `❌ Unknown agent \`${maybeAgent}\`. Try \`${prefix} agents list\`.`,
          audit: { command: 'tick', args: rest },
        };
      }
      await inngest.send({
        name: 'agent/tick',
        data: { agentId: maybeAgent, force: true },
      });
      return {
        ok: true,
        message: `✅ Triggered tick for \`${maybeAgent}\``,
        audit: { command: 'tick', args: rest },
      };
    }
    await inngest.send({ name: 'agent/tick.all', data: { force: true } });
    return { ok: true, message: '✅ Triggered tick for *all agents*', audit: { command: 'tick', args: [] } };
  }

  if (cmd === 'pause') {
    await ensureAllAgentRowsExist();
    await setAllAgentsActiveInDb(false);
    return {
      ok: true,
      message: '⏸️ Marked all agents *inactive* in DB (they will skip ticks).',
      audit: { command: 'pause', args: [] },
    };
  }

  if (cmd === 'resume') {
    await ensureAllAgentRowsExist();
    await setAllAgentsActiveInDb(true);
    return { ok: true, message: '▶️ Marked all agents *active* in DB.', audit: { command: 'resume', args: [] } };
  }

  if (cmd === 'scenarios' || (cmd === 'scenario' && rest[0] === 'list')) {
    const lines = Object.entries(SCENARIO_EVENTS).map(
      ([k, s]) => `- \`${k}\`: ${s.description}`
    );
    return {
      ok: true,
      message: ['*Available scenarios*', ...lines].join('\n'),
      audit: { command: cmd === 'scenarios' ? 'scenarios' : 'scenario list', args: rest },
    };
  }

  if (cmd === 'scenario') {
    const key = rest[0];
    if (!key) {
      return {
        ok: false,
        message: `❌ Missing scenario name. Try \`${prefix} scenarios\`.`,
        audit: { command: 'scenario', args: rest },
      };
    }
    const scenario = SCENARIO_EVENTS[key];
    if (!scenario) {
      return {
        ok: false,
        message: `❌ Unknown scenario \`${key}\`. Try \`${prefix} scenarios\`.`,
        audit: { command: 'scenario', args: rest },
      };
    }

    const kv = parseKeyValueArgs(rest.slice(1));
    const payload: Record<string, unknown> = {};

    // Best-effort: only pass supported args for specific scenarios.
    if (key === 'advisor-checkin') {
      if (typeof kv.topic === 'string' && kv.topic.length > 0) {
        payload.topic = kv.topic;
      }
    }
    if (key === 'investor-pressure') {
      if (typeof kv.deadline === 'string' && kv.deadline.length > 0) {
        payload.deadline = kv.deadline;
      }
    }

    await inngest.send({ name: scenario.eventName, data: payload });

    // Optionally: immediately tick all agents so the seed is noticed quickly.
    const autoTick = process.env.SLACK_CONTROL_AUTOTICK_AFTER_SCENARIO !== 'false';
    if (autoTick) {
      await inngest.send({ name: 'agent/tick.all', data: { force: true } });
    }

    return {
      ok: true,
      message: `🎬 Triggered scenario \`${key}\`${autoTick ? ' and triggered `tick.all`' : ''}.`,
      audit: { command: 'scenario', args: rest },
    };
  }

  if (cmd === 'agents') {
    // Convenience: !hs agents on/off
    const sub = (rest[0] || '').toLowerCase();
    if (sub === 'on' || sub === 'resume') {
      await ensureAllAgentRowsExist();
      await setAllAgentsActiveInDb(true);
      return {
        ok: true,
        message: '▶️ Marked all agents *active* in DB.',
        audit: { command: 'agents on', args: rest },
      };
    }
    if (sub === 'off' || sub === 'pause') {
      await ensureAllAgentRowsExist();
      await setAllAgentsActiveInDb(false);
      return {
        ok: true,
        message: '⏸️ Marked all agents *inactive* in DB (they will skip ticks).',
        audit: { command: 'agents off', args: rest },
      };
    }
    if (sub === 'list') {
      return {
        ok: true,
        message: `Known agents: ${ALL_AGENT_IDS.map((a) => `\`${a}\``).join(', ')}`,
        audit: { command: 'agents list', args: [] },
      };
    }
    return {
      ok: false,
      message: `❌ Unknown \`agents\` subcommand. Try \`${prefix} help\`.`,
      audit: { command: 'agents', args: rest },
    };
  }

  return {
    ok: false,
    message: `❌ Unknown command \`${cmd}\`. Try \`${prefix} help\`.`,
    audit: { command: cmd, args: rest },
  };
}

export const slackControlCommandFunction = inngest.createFunction(
  {
    id: 'slack-control-command',
    retries: 0,
  },
  { event: 'slack/control.command' },
  async ({ event, step }) => {
    const parsed = SlackControlCommandEventSchema.safeParse(event.data);
    if (!parsed.success) {
      return { status: 'ignored', reason: 'invalid_payload' };
    }

    const data: SlackControlCommandEvent = parsed.data;
    const threadTs = data.threadTs ?? data.ts;

    const result = await step.run('execute-command', async () => runCommand(data.text));

    await step.run('reply-in-slack', async () => {
      const botPrefix = result.ok ? '' : '';
      const message = `${botPrefix}${result.message}`;
      await slack.postMessage(data.channel, message, { threadTs });
    });

    // Log to agent_actions as a "control" action (not used in prompts).
    await step.run('log-control-action', async () => {
      // Ensure a stable FK target exists before logging.
      await db.upsertAgentState(chanceAdvisor.id, chanceAdvisor, { isActive: true });
      await db.logAgentAction({
        agentId: chanceAdvisor.id,
        actionType: 'control_command',
        payload: {
          type: 'control_command',
          eventId: data.eventId,
          channel: data.channel,
          user: data.user,
          audit: result.audit ?? { command: 'unknown', args: [] },
          ts: data.ts,
          result,
        },
        reasoning: 'Slack control command',
        success: result.ok,
        errorMessage: result.ok ? undefined : result.message,
      });
    });

    return { status: 'handled', ok: result.ok };
  }
);


