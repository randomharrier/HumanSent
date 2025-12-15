/**
 * Agent Tick Function
 *
 * The core loop that runs each agent's decision cycle.
 */

import { inngest } from '../inngest-client';
import { getAgent, getOtherAgents, ALL_AGENT_IDS } from '../agents';
import { gmail, slack, llm, db } from '../services';
import { isBusinessHours, getDayOfWeek, ENV, getTickIntervalMinutes } from '../config';
import type { AgentContext, AgentState, EmailMessage, SlackMessage, AgentTask } from '../types/agent';
import type { AgentAction, ActionResult } from '../types/actions';

// Helpers to reconstruct dates from Inngest serialization
function hydrateState(state: Record<string, unknown>): AgentState {
  return {
    ...state,
    lastTickAt: state.lastTickAt ? new Date(state.lastTickAt as string) : null,
    budgetResetAt: new Date(state.budgetResetAt as string),
    createdAt: new Date(state.createdAt as string),
    updatedAt: new Date(state.updatedAt as string),
  } as AgentState;
}

function hydrateTask(task: Record<string, unknown>): AgentTask {
  return {
    ...task,
    snoozedUntil: task.snoozedUntil ? new Date(task.snoozedUntil as string) : null,
    dueAt: task.dueAt ? new Date(task.dueAt as string) : null,
    createdAt: new Date(task.createdAt as string),
    updatedAt: new Date(task.updatedAt as string),
  } as AgentTask;
}

function hydrateEmail(email: Record<string, unknown>): EmailMessage {
  return {
    ...email,
    timestamp: new Date(email.timestamp as string),
  } as EmailMessage;
}

function hydrateSlackMessage(msg: Record<string, unknown>): SlackMessage {
  return {
    ...msg,
    timestamp: new Date(msg.timestamp as string),
  } as SlackMessage;
}

// ============================================
// Agent Tick Function
// ============================================

export const agentTickFunction = inngest.createFunction(
  {
    id: 'agent-tick',
    concurrency: {
      limit: 5, // Max 5 agents ticking concurrently
    },
    retries: 2,
  },
  { event: 'agent/tick' },
  async ({ event, step }) => {
    const { agentId, force } = event.data;
    const startTime = Date.now();
    let tickIdForError: string | undefined;

    // Validate agent exists
    const persona = getAgent(agentId);
    if (!persona) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    // Check if agent is disabled
    if (ENV.disabledAgents.includes(agentId)) {
      return { status: 'skipped', reason: 'Agent is disabled' };
    }

    // Check business hours (unless forced)
    if (!force && !isBusinessHours()) {
      return { status: 'skipped', reason: 'Outside business hours' };
    }

    try {
      // Step 1: Ensure agent state exists
      const rawState = await step.run('get-state', () => db.getAgentState(agentId));
      let state = rawState ? hydrateState(rawState as unknown as Record<string, unknown>) : null;

      if (!state) {
        const newState = await step.run('init-state', () =>
          db.upsertAgentState(agentId, persona, { budgetRemaining: ENV.dailyBudget })
        );
        state = hydrateState(newState as unknown as Record<string, unknown>);
      }

      // Respect DB pause/resume (agent_state.is_active)
      if (!state.isActive) {
        return { status: 'skipped', reason: 'Agent is inactive' };
      }

      // Enforce minimum tick interval unless forced.
      // Leadership agents tick faster (for Precedent testing)
      const tickInterval = getTickIntervalMinutes(agentId);
      if (!force && state.lastTickAt) {
        const minutesSinceLastTick = (Date.now() - state.lastTickAt.getTime()) / (60 * 1000);
        if (minutesSinceLastTick < tickInterval) {
          return {
            status: 'skipped',
            reason: `Tick interval not reached (${Math.floor(minutesSinceLastTick)}m < ${tickInterval}m)`,
          };
        }
      }

      // Create tick record AFTER agent_state exists (agent_ticks has FK to agent_state)
      const tickId = await step.run('create-tick', () => db.createTick(agentId));
      tickIdForError = tickId;

      // Check and reset daily budget if needed
      const today = new Date().toISOString().split('T')[0];
      const budgetResetDate = state.budgetResetAt.toISOString().split('T')[0];
      if (budgetResetDate !== today) {
        const resetState = await step.run('reset-budget', () =>
          db.upsertAgentState(agentId, persona, { budgetRemaining: ENV.dailyBudget })
        );
        state = hydrateState(resetState as unknown as Record<string, unknown>);
      }

      // Check if budget exhausted
      if (state.budgetRemaining <= 0) {
        await step.run('update-tick-no-budget', () =>
          db.updateTick(tickId, {
            status: 'skipped',
            completedAt: new Date(),
            errorMessage: 'Daily budget exhausted',
          })
        );
        return { status: 'skipped', reason: 'Daily budget exhausted' };
      }

      // Step 2: Gather context
      const rawContext = await step.run('gather-context', async () => {
        // Get recent emails
        let recentEmails: EmailMessage[] = [];
        try {
          recentEmails = await gmail.getRecentEmails(persona.email, {
            maxResults: 20,
            includeRead: false,
            hoursBack: 48,
          });
        } catch (error) {
          console.error(`Failed to fetch emails for ${agentId}:`, error);
        }

        // Get recent Slack messages from relevant channels and sync to Supabase
        let recentSlackMessages: SlackMessage[] = [];
        try {
          const channelIds = await slack.getAgentChannelIds(agentId);
          if (channelIds.length > 0) {
            const { messages, syncStats } = await slack.getAndSyncChannelMessages(channelIds, {
              limitPerChannel: 10,
              hoursBack: 24,
            });
            recentSlackMessages = messages;
            
            if (syncStats.messagesSynced > 0) {
              console.info(`Synced ${syncStats.messagesSynced} Slack messages, ${syncStats.conversationsUpdated} conversations for ${agentId}`);
            }
          }
        } catch (error) {
          console.error(`Failed to fetch Slack messages for ${agentId}:`, error);
        }

        // Get open tasks
        const openTasks = await db.getOpenTasks(agentId);

        // Get recent actions (what this agent has done recently)
        const rawRecentActions = await db.getRecentActions(agentId, 48);
        const recentActions = rawRecentActions.map((a) => ({
          actionType: a.actionType,
          summary: summarizeAction(a.actionType, a.payload),
          timestamp: a.createdAt,
          success: a.success,
          errorMessage: a.errorMessage,
        }));

        return {
          recentEmails,
          recentSlackMessages,
          openTasks,
          recentActions,
          currentTime: new Date().toISOString(),
          dayOfWeek: getDayOfWeek(),
          isBusinessHours: isBusinessHours(),
        };
      });

      // Build context with hydrated types
      const context: AgentContext = {
        agent: persona,
        state,
        recentEmails: (rawContext.recentEmails as unknown as Record<string, unknown>[]).map(hydrateEmail),
        recentSlackMessages: (rawContext.recentSlackMessages as unknown as Record<string, unknown>[]).map(hydrateSlackMessage),
        openTasks: (rawContext.openTasks as unknown as Record<string, unknown>[]).map(hydrateTask),
        recentActions: (rawContext.recentActions as unknown as Array<{ actionType: string; summary: string; timestamp: string }>).map(
          (a) => ({ ...a, timestamp: new Date(a.timestamp) })
        ),
        currentTime: new Date(rawContext.currentTime),
        dayOfWeek: rawContext.dayOfWeek,
        isBusinessHours: rawContext.isBusinessHours,
        otherAgents: getOtherAgents(agentId),
      };

      // Update tick with context stats
      await step.run('update-tick-context', () =>
        db.updateTick(tickId, {
          emailsFound: context.recentEmails.length,
          slackMessagesFound: context.recentSlackMessages.length,
          openTasks: context.openTasks.length,
        })
      );

      // Step 3: Get LLM decision
      const llmResponse = await step.run('llm-decision', () => llm.getAgentDecision(context));

      // Update tick with LLM stats
      await step.run('update-tick-llm', () =>
        db.updateTick(tickId, {
          promptTokens: llmResponse.promptTokens,
          completionTokens: llmResponse.completionTokens,
          llmModel: llmResponse.model,
          llmLatencyMs: llmResponse.latencyMs,
          actionsPlanned: llmResponse.output.actions.length,
          rawLlmResponse: llmResponse.rawResponse,
        })
      );

      // Step 4: Execute actions
      const results: ActionResult[] = [];
      let budgetUsed = 0;

      for (const action of llmResponse.output.actions) {
        const result = await step.run(`execute-${action.type}`, async () => {
          return executeAction(agentId, persona.email, tickId, action, context);
        });

        results.push(result);

        if (result.success) {
          const cost = getActionCost(action.type);
          budgetUsed += cost;
        }
      }

      // Step 5: Update state (including memory)
      const newBudget = Math.max(0, state.budgetRemaining - budgetUsed);

      // Merge memory updates from LLM response into agent notes
      const currentNotes = (state.notes || {}) as {
        observations?: string[];
        lastUpdated?: string;
      };
      const memoryUpdates = llmResponse.output.memoryUpdates;

      let updatedNotes = { ...currentNotes };
      if (memoryUpdates) {
        // Add new observations (keep last 20 to avoid unbounded growth)
        const existingObs = currentNotes.observations || [];
        const newObs = memoryUpdates.observations || [];
        const forgetSet = new Set(memoryUpdates.forget || []);

        // Filter out forgotten items and add new ones
        const filteredObs = existingObs.filter(
          (obs) => !forgetSet.has(obs) && !newObs.some((n) => n.toLowerCase() === obs.toLowerCase())
        );
        const mergedObs = [...newObs, ...filteredObs].slice(0, 20);

        updatedNotes = {
          observations: mergedObs,
          lastUpdated: new Date().toISOString(),
        };
      }

      await step.run('update-state', () =>
        db.upsertAgentState(agentId, persona, {
          lastTickAt: new Date(),
          lastTickId: tickId,
          budgetRemaining: newBudget,
          notes: updatedNotes,
        })
      );

      // Complete tick
      const actionsExecuted = results.filter((r) => r.success).length;
      await step.run('complete-tick', () =>
        db.updateTick(tickId, {
          status: 'completed',
          completedAt: new Date(),
          actionsExecuted,
        })
      );

      return {
        status: 'completed',
        tickId,
        agentId,
        actionsPlanned: llmResponse.output.actions.length,
        actionsExecuted,
        budgetUsed,
        budgetRemaining: newBudget,
        durationMs: Date.now() - startTime,
        reasoning: llmResponse.output.reasoning,
      };
    } catch (error) {
      // Log error and mark tick as failed
      const errorMessage = error instanceof Error ? error.message : String(error);

      const tid = tickIdForError;
      if (tid) {
        await step.run('fail-tick', () =>
          db.updateTick(tid, {
            status: 'failed',
            completedAt: new Date(),
            errorMessage,
          })
        );
      }

      throw error;
    }
  }
);

// ============================================
// Tick All Agents Function
// ============================================

export const agentTickAllFunction = inngest.createFunction(
  {
    id: 'agent-tick-all',
    retries: 0, // Don't retry the orchestrator
  },
  [
    { event: 'agent/tick.all' },
    // Schedule: Every 30 minutes during business hours, M-F
    // Run every 5 min, 24/7. The isBusinessHours() check in code handles timezone.
    { cron: '*/5 * * * *' }, // Every 5 min, every day
  ],
  async ({ event, step }) => {
    const force = event?.data?.force ?? false;
    const agentIds = event?.data?.agentIds ?? ALL_AGENT_IDS;

    // Filter out disabled agents
    const activeAgents = agentIds.filter((id: string) => !ENV.disabledAgents.includes(id));

    // Send tick events for all agents
    await step.sendEvent(
      'trigger-agent-ticks',
      activeAgents.map((agentId: string) => ({
        name: 'agent/tick' as const,
        data: { agentId, force },
      }))
    );

    return {
      status: 'triggered',
      agentCount: activeAgents.length,
      agents: activeAgents,
      force,
      timestamp: new Date().toISOString(),
    };
  }
);

// ============================================
// Action Execution
// ============================================

async function executeAction(
  agentId: string,
  agentEmail: string,
  tickId: string,
  action: AgentAction,
  _context: AgentContext
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'send_email': {
        // HARD BLOCK: Never send emails outside @humansent.co
        const allRecipients = [...action.to, ...(action.cc || [])];
        const externalEmails = allRecipients.filter(
          (email) => !email.endsWith('@humansent.co')
        );
        
        if (externalEmails.length > 0) {
          const errorMessage = `BLOCKED: Attempted to email external addresses: ${externalEmails.join(', ')}. Agents may ONLY email @humansent.co addresses.`;
          console.error(`[SECURITY] ${agentId}: ${errorMessage}`);
          
          await db.logAgentAction({
            agentId,
            tickId,
            actionType: action.type,
            payload: action,
            success: false,
            errorMessage,
          });
          
          return { action, success: false, error: errorMessage };
        }

        const result = await gmail.sendEmailWithDryRun(agentEmail, {
          to: action.to,
          cc: action.cc,
          subject: action.subject,
          body: action.body,
          inReplyTo: action.inReplyTo,
          threadId: action.conversationId,
        });

        // Save sent email to messages table for agent memory
        // This ensures agents see their own sent emails in context
        if (!result.dryRun && result.messageId) {
          const conversationId = result.threadId || result.messageId;

          // Extract recipient agent IDs from email addresses
          const toAgents = action.to
            .filter((email: string) => email.endsWith('@humansent.co'))
            .map((email: string) => email.replace('@humansent.co', ''));

          // Upsert conversation first (messages have FK to conversations)
          await db.upsertConversation({
            id: `email:${conversationId}`,
            type: 'email',
            subject: action.subject,
            participants: [agentId, ...toAgents],
            lastActivityAt: new Date(),
            messageCount: 1,
            metadata: { threadId: result.threadId },
          });

          await db.upsertMessages([
            {
              id: `email:${result.messageId}`,
              conversationId: `email:${conversationId}`,
              type: 'email',
              fromAgent: agentId,
              toAgents,
              subject: action.subject,
              bodyPreview: action.body.slice(0, 500),
              fullBody: action.body,
              timestamp: new Date(),
              isRead: false,
              metadata: {
                messageId: result.messageId,
                threadId: result.threadId,
                to: action.to,
                cc: action.cc,
              },
            },
          ]);
        }

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: { ...action, result },
          success: !result.dryRun,
          errorMessage: result.dryRun ? 'DRY_RUN_MODE enabled (email not sent)' : undefined,
        });

        return result.dryRun
          ? { action, success: false, error: 'DRY_RUN_MODE enabled (email not sent)', metadata: result }
          : { action, success: true, metadata: result };
      }

      case 'send_slack_message': {
        // Resolve channel name to ID if needed
        let channelId = action.channel;
        const channelName = action.channel.replace(/^#/, '');
        if (action.channel.startsWith('#')) {
          const resolved = await slack.getChannelIdByName(action.channel);
          if (!resolved) {
            throw new Error(`Channel not found: ${action.channel}`);
          }
          channelId = resolved;
        }

        // Guardrail: @Precedent must be contacted via DM using use_precedent.
        // If an agent tries to mention Precedent in a channel, block and nudge them.
        if (/@precedent\b/i.test(action.text) || /precedent ai/i.test(action.text)) {
          const errorMessage =
            'Precedent must be contacted via DM (use the use_precedent action). Posting @Precedent in channels will not work.';
          await db.logAgentAction({
            agentId,
            tickId,
            actionType: action.type,
            payload: action,
            success: false,
            errorMessage,
          });
          return { action, success: false, error: errorMessage };
        }

        // Get agent persona for username override
        const slackPersona = getAgent(agentId);
        const result = await slack.postMessageWithDryRun(channelId, action.text, {
          threadTs: action.threadTs,
          username: slackPersona?.name,
        });

        // Save sent message to messages table for agent memory
        // This ensures agents see their own sent messages in context
        if (!result.dryRun) {
          const conversationId = action.threadTs
            ? `slack:${channelId}:${action.threadTs}`
            : `slack:${channelId}:${result.ts}`;

          // Upsert conversation first (messages have FK to conversations)
          await db.upsertConversation({
            id: conversationId,
            type: 'slack',
            subject: `#${channelName}`,
            participants: [agentId],
            lastActivityAt: new Date(),
            messageCount: 1,
            metadata: { channelName, channelId },
          });

          await db.upsertMessages([
            {
              id: `slack:${channelId}:${result.ts}`,
              conversationId,
              type: 'slack',
              fromAgent: agentId,
              bodyPreview: action.text.slice(0, 500),
              fullBody: action.text,
              timestamp: new Date(),
              isRead: true,
              metadata: {
                channel: channelId,
                channelName,
                ts: result.ts,
                threadTs: action.threadTs,
              },
            },
          ]);
        }

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: { ...action, result },
          success: !result.dryRun,
          errorMessage: result.dryRun ? 'DRY_RUN_MODE enabled (Slack message not sent)' : undefined,
        });

        return result.dryRun
          ? { action, success: false, error: 'DRY_RUN_MODE enabled (Slack message not sent)', metadata: result }
          : { action, success: true, metadata: result };
      }

      case 'create_task': {
        const task = await db.createTask({
          agentId: action.assignedTo,
          createdBy: agentId,
          title: action.title,
          description: action.description,
          dueAt: action.dueAt ? new Date(action.dueAt) : undefined,
          linkedConversationId: action.linkedConversationId,
        });

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: { ...action, taskId: task.id },
          success: true,
        });

        return { action, success: true, metadata: { taskId: task.id } };
      }

      case 'mark_task_done': {
        await db.markTaskDone(action.taskId);

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: action,
          success: true,
        });

        return { action, success: true };
      }

      case 'snooze_task': {
        await db.snoozeTask(action.taskId, new Date(action.until));

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: action,
          success: true,
        });

        return { action, success: true };
      }

      case 'use_precedent': {
        if (!ENV.enablePrecedentIntegration) {
          await db.logAgentAction({
            agentId,
            tickId,
            actionType: action.type,
            payload: action,
            reasoning: 'Precedent integration disabled',
            success: false,
            errorMessage: 'Precedent integration disabled',
          });
          return { action, success: false, error: 'Precedent integration disabled' };
        }

        const precedentUserId = process.env.PRECEDENT_SLACK_USER_ID;
        if (!precedentUserId) {
          const errorMessage =
            'Missing PRECEDENT_SLACK_USER_ID environment variable (Precedent must be contacted via DM).';
          await db.logAgentAction({
            agentId,
            tickId,
            actionType: action.type,
            payload: action,
            success: false,
            errorMessage,
          });
          return { action, success: false, error: errorMessage };
        }

        // Build message to @Precedent
        let precedentMessage: string;
        if (action.intent === 'query' && action.query) {
          // Natural follow-up question
          precedentMessage = `@Precedent ${action.query}`;
        } else {
          // Structured intent
          precedentMessage = `@Precedent ${action.intent}${action.extraContext ? ` (${action.extraContext})` : ''}`;
        }

        // Get agent persona for username override
        const precedentPersona = getAgent(agentId);
        const result = await slack.sendDirectMessageWithDryRun(precedentUserId, precedentMessage, {
          threadTs: action.threadTs,
          username: precedentPersona?.name,
        });

        // Save message to DB so agent remembers they asked
        if (!result.dryRun) {
          const conversationId = action.threadTs
            ? `slack:${result.channel}:${action.threadTs}`
            : `slack:${result.channel}:${result.ts}`;

          await db.upsertConversation({
            id: conversationId,
            type: 'slack',
            subject: 'DM: Precedent',
            participants: [agentId],
            lastActivityAt: new Date(),
            messageCount: 1,
            metadata: { channelId: result.channel, isPrecedentConversation: true, precedentUserId },
          });

          await db.upsertMessages([
            {
              id: `slack:${result.channel}:${result.ts}`,
              conversationId,
              type: 'slack',
              fromAgent: agentId,
              bodyPreview: precedentMessage.slice(0, 500),
              fullBody: precedentMessage,
              timestamp: new Date(),
              isRead: true,
              metadata: {
                channel: result.channel,
                ts: result.ts,
                threadTs: action.threadTs,
                isPrecedentQuery: true,
              },
            },
          ]);
        }

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: { ...action, result },
          success: !result.dryRun,
          errorMessage: result.dryRun ? 'DRY_RUN_MODE enabled (Precedent DM not sent)' : undefined,
        });

        return result.dryRun
          ? { action, success: false, error: 'DRY_RUN_MODE enabled (Precedent DM not sent)', metadata: result }
          : { action, success: true, metadata: result };
      }

      case 'no_action': {
        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: action,
          reasoning: action.reason,
          success: true,
        });

        return { action, success: true };
      }

      default: {
        const _exhaustive: never = action;
        throw new Error(`Unknown action type: ${(_exhaustive as AgentAction).type}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db.logAgentAction({
      agentId,
      tickId,
      actionType: action.type,
      payload: action,
      success: false,
      errorMessage,
    });

    return { action, success: false, error: errorMessage };
  }
}

// ============================================
// Helpers
// ============================================

function getActionCost(actionType: AgentAction['type']): number {
  const costs: Record<AgentAction['type'], number> = {
    send_email: 10,
    send_slack_message: 5,
    create_task: 3,
    mark_task_done: 1,
    snooze_task: 1,
    use_precedent: 5,
    no_action: 0,
  };
  return costs[actionType];
}

/**
 * Create a human-readable summary of an action for context
 */
function summarizeAction(actionType: string, payload: Record<string, unknown>): string {
  switch (actionType) {
    case 'send_email': {
      const to = (payload.to as string[])?.join(', ') || 'unknown';
      const subject = (payload.subject as string) || '(no subject)';
      return `Sent email to ${to}: "${subject}"`;
    }
    case 'send_slack_message': {
      const channel = (payload.channel as string) || 'unknown';
      const text = (payload.text as string)?.slice(0, 50) || '';
      return `Posted in ${channel}: "${text}..."`;
    }
    case 'create_task': {
      const title = (payload.title as string) || 'untitled';
      const assignedTo = (payload.assignedTo as string) || 'unknown';
      return `Created task "${title}" for ${assignedTo}`;
    }
    case 'mark_task_done':
      return `Marked task as done`;
    case 'snooze_task':
      return `Snoozed task until ${payload.until || 'later'}`;
    case 'use_precedent':
      return `Used Precedent: ${payload.intent || 'query'}`;
    case 'no_action':
      return `No action: ${payload.reason || 'nothing to do'}`;
    default:
      return `${actionType}`;
  }
}

