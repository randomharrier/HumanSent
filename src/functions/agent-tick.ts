/**
 * Agent Tick Function
 *
 * The core loop that runs each agent's decision cycle.
 */

import { inngest } from '../inngest-client';
import { getAgent, getOtherAgents, ALL_AGENT_IDS } from '../agents';
import { gmail, slack, llm, db } from '../services';
import { isBusinessHours, getDayOfWeek, ENV } from '../config';
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

    // Create tick record
    const tickId = await step.run('create-tick', () => db.createTick(agentId));

    try {
      // Step 1: Ensure agent state exists
      const rawState = await step.run('get-state', () => db.getAgentState(agentId));
      let state = rawState ? hydrateState(rawState as unknown as Record<string, unknown>) : null;

      if (!state) {
        const newState = await step.run('init-state', () =>
          db.upsertAgentState(agentId, persona, { budgetRemaining: 100 })
        );
        state = hydrateState(newState as unknown as Record<string, unknown>);
      }

      // Check and reset daily budget if needed
      const today = new Date().toISOString().split('T')[0];
      const budgetResetDate = state.budgetResetAt.toISOString().split('T')[0];
      if (budgetResetDate !== today) {
        const resetState = await step.run('reset-budget', () =>
          db.upsertAgentState(agentId, persona, { budgetRemaining: 100 })
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

        // Get recent Slack messages from relevant channels
        let recentSlackMessages: SlackMessage[] = [];
        try {
          const channelIds = await slack.getAgentChannelIds(agentId);
          if (channelIds.length > 0) {
            recentSlackMessages = await slack.getMessagesFromChannels(channelIds, {
              limitPerChannel: 10,
              hoursBack: 24,
            });
          }
        } catch (error) {
          console.error(`Failed to fetch Slack messages for ${agentId}:`, error);
        }

        // Get open tasks
        const openTasks = await db.getOpenTasks(agentId);

        return {
          recentEmails,
          recentSlackMessages,
          openTasks,
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

      // Step 5: Update state
      const newBudget = Math.max(0, state.budgetRemaining - budgetUsed);
      await step.run('update-state', () =>
        db.upsertAgentState(agentId, persona, {
          lastTickAt: new Date(),
          lastTickId: tickId,
          budgetRemaining: newBudget,
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

      await step.run('fail-tick', () =>
        db.updateTick(tickId, {
          status: 'failed',
          completedAt: new Date(),
          errorMessage,
        })
      );

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
    { cron: '*/5 6-23 * * *' }, // Every 5 min, 6am-11pm, every day (for testing)
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
        const result = await gmail.sendEmailWithDryRun(agentEmail, {
          to: action.to,
          cc: action.cc,
          subject: action.subject,
          body: action.body,
          inReplyTo: action.inReplyTo,
          threadId: action.conversationId,
        });

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: { ...action, result },
          success: true,
        });

        return { action, success: true, metadata: result };
      }

      case 'send_slack_message': {
        // Resolve channel name to ID if needed
        let channelId = action.channel;
        if (action.channel.startsWith('#')) {
          const resolved = await slack.getChannelIdByName(action.channel);
          if (!resolved) {
            throw new Error(`Channel not found: ${action.channel}`);
          }
          channelId = resolved;
        }

        const result = await slack.postMessageWithDryRun(channelId, action.text, {
          threadTs: action.threadTs,
        });

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: { ...action, result },
          success: true,
        });

        return { action, success: true, metadata: result };
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

        // Post to Precedent in Slack (assuming there's a @Precedent bot)
        // This would be channel-specific in reality
        const precedentMessage = `@Precedent ${action.intent}${action.extraContext ? ` (${action.extraContext})` : ''}`;

        // Find a leadership channel to post in
        const channelIds = await slack.getAgentChannelIds(agentId);
        if (channelIds.length === 0) {
          throw new Error('No Slack channels available for Precedent interaction');
        }

        const result = await slack.postMessageWithDryRun(channelIds[0], precedentMessage);

        await db.logAgentAction({
          agentId,
          tickId,
          actionType: action.type,
          payload: { ...action, result },
          success: true,
        });

        return { action, success: true, metadata: result };
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

