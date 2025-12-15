/**
 * User prompt assembly for agent context
 */

import type { AgentContext, EmailMessage, SlackMessage, AgentTask, RecentAction } from '../types/agent';
import { ENV } from '../config';
import { AGENT_CHANNELS, isDryRunMode as isSlackDryRunMode } from '../services/slack';
import { isDryRunMode as isGmailDryRunMode } from '../services/gmail';

/**
 * Build the user prompt with current context
 */
export function buildUserPrompt(context: AgentContext): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Current Context for ${context.agent.name}`);
  sections.push('');

  // Time context
  sections.push('## Time');
  sections.push(`- Current time: ${context.currentTime.toISOString()}`);
  sections.push(`- Day: ${context.dayOfWeek}`);
  sections.push(`- Business hours: ${context.isBusinessHours ? 'Yes' : 'No'}`);
  sections.push('');

  // Budget
  sections.push('## Your Budget');
  sections.push(`- Remaining today: ${context.state.budgetRemaining}/100`);
  sections.push('');

  // Integration / simulation status (keeps agents honest about what actually happened)
  const dryRunMode = isSlackDryRunMode() || isGmailDryRunMode();
  const slackConfigured = !!process.env.SLACK_BOT_TOKEN;
  const gmailConfigured =
    !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const precedentTargetConfigured = !!process.env.PRECEDENT_SLACK_USER_ID;

  sections.push('## Simulation / Integration Status');
  sections.push(`- DRY_RUN_MODE: ${dryRunMode ? 'true' : 'false'}`);
  sections.push(`- Slack configured: ${slackConfigured ? 'Yes' : 'No'}`);
  sections.push(`- Gmail configured: ${gmailConfigured ? 'Yes' : 'No'}`);
  sections.push(`- Precedent integration enabled: ${ENV.enablePrecedentIntegration ? 'Yes' : 'No'}`);
  sections.push(`- Precedent DM target configured: ${precedentTargetConfigured ? 'Yes' : 'No'}`);
  sections.push('');

  // Memory (persistent observations from previous ticks)
  const notes = context.state.notes as { observations?: string[]; lastUpdated?: string } | undefined;
  if (notes?.observations && notes.observations.length > 0) {
    sections.push('## Your Memory (things you noted previously)');
    for (const obs of notes.observations) {
      sections.push(`- ${obs}`);
    }
    sections.push('');
  }

  // Recent actions (what you've done recently)
  sections.push('## Your Recent Actions (last 48h)');
  if (context.recentActions.length === 0) {
    sections.push('No recent actions.');
  } else {
    for (const action of context.recentActions.slice(0, 10)) {
      const status =
        action.success === false
          ? ` (NOT EXECUTED${action.errorMessage ? `: ${action.errorMessage}` : ''})`
          : '';
      sections.push(`- ${formatTime(action.timestamp)}: ${action.summary}${status}`);
    }
  }
  sections.push('');

  // Recent emails
  sections.push('## Recent Emails');
  if (context.recentEmails.length === 0) {
    sections.push('No new emails.');
  } else {
    for (const email of context.recentEmails) {
      sections.push(formatEmail(email, context));
    }
  }
  sections.push('');

  // Recent Slack
  sections.push('## Recent Slack Messages');
  if (context.recentSlackMessages.length === 0) {
    sections.push('No new Slack messages in your channels.');
  } else {
    for (const msg of context.recentSlackMessages) {
      sections.push(formatSlackMessage(msg, context));
    }
  }
  sections.push('');

  // Open tasks
  sections.push('## Your Open Tasks');
  if (context.openTasks.length === 0) {
    sections.push('No open tasks.');
  } else {
    for (const task of context.openTasks) {
      sections.push(formatTask(task));
    }
  }
  sections.push('');

  // Team reference - ONLY these email addresses are valid
  sections.push('## Team Directory (ONLY valid email addresses)');
  sections.push('You may ONLY send emails to these addresses. Do not invent or guess email addresses.');
  sections.push('');
  sections.push(`- ${context.agent.name} (you): ${context.agent.email}`);
  for (const agent of context.otherAgents) {
    sections.push(`- ${agent.name} (${agent.role}): ${agent.email}`);
  }
  sections.push('');

  // Slack channels - ONLY these channels are available
  const agentChannels = AGENT_CHANNELS[context.agent.id] || [];
  sections.push('## Your Slack Channels (ONLY these exist)');
  sections.push('You may ONLY post to these channels. Do not use any other channel names.');
  sections.push('');
  if (agentChannels.length === 0) {
    sections.push('You do not have access to any Slack channels.');
  } else {
    for (const channel of agentChannels) {
      sections.push(`- #${channel}`);
    }
  }
  sections.push('');

  // Prompt for action
  sections.push('---');
  sections.push('');
  sections.push('Based on this context, what actions (if any) should you take?');
  sections.push('');
  sections.push('Remember:');
  sections.push('- Stay in character as ' + context.agent.name);
  sections.push('- Prioritize based on your role and relationships');
  sections.push("- It's okay to do nothing if nothing requires your attention");
  sections.push('- Be mindful of your budget');
  sections.push('');
  sections.push('Respond with JSON.');

  return sections.join('\n');
}

/**
 * Format an email for the prompt
 */
function formatEmail(email: EmailMessage, context: AgentContext): string {
  const lines: string[] = [];

  // Determine relationship to sender
  const senderAgentId = emailToAgentId(email.from);
  const relationship = senderAgentId
    ? context.agent.relationships.find((r) => r.agentId === senderAgentId)
    : null;

  const relationshipNote = relationship
    ? ` [${relationship.type}, ${relationship.sentiment}]`
    : '';

  lines.push(`### Email from ${email.fromName || email.from}${relationshipNote}`);
  lines.push(`- ID: ${email.id}`);
  lines.push(`- Thread: ${email.threadId}`);
  lines.push(`- Subject: ${email.subject}`);
  lines.push(`- Time: ${formatTime(email.timestamp)}`);
  lines.push(`- Status: ${email.isRead ? 'Read' : 'UNREAD'}`);
  lines.push('');
  lines.push('Body:');
  lines.push('```');
  const rawBody = (email.fullBody || email.bodyPreview || '').trim();
  const maxChars = 4000;
  const clipped = rawBody.length > maxChars ? `${rawBody.slice(0, maxChars)}\n\n[...truncated...]` : rawBody;
  lines.push(clipped || '(no content)');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a Slack message for the prompt
 */
function formatSlackMessage(msg: SlackMessage, context: AgentContext): string {
  const lines: string[] = [];

  // Try to identify the sender
  const senderName = msg.userName || msg.userId;
  const senderAgentId = slackUserToAgentId(msg.userId, context);
  const relationship = senderAgentId
    ? context.agent.relationships.find((r) => r.agentId === senderAgentId)
    : null;

  const relationshipNote = relationship ? ` [${relationship.type}]` : '';

  lines.push(`### Slack: ${msg.channelName || msg.channel}`);
  lines.push(`- From: ${senderName}${relationshipNote}`);
  lines.push(`- Time: ${formatTime(msg.timestamp)}`);
  if (msg.threadTs) {
    lines.push(`- Thread: ${msg.threadTs}`);
  }
  lines.push(`- Message: ${msg.text}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a task for the prompt
 */
function formatTask(task: AgentTask): string {
  const lines: string[] = [];

  lines.push(`### Task: ${task.title}`);
  lines.push(`- ID: ${task.id}`);
  lines.push(`- Status: ${task.status}`);
  if (task.description) {
    lines.push(`- Description: ${task.description}`);
  }
  if (task.dueAt) {
    lines.push(`- Due: ${formatTime(task.dueAt)}`);
  }
  if (task.createdBy !== task.agentId) {
    lines.push(`- Assigned by: ${task.createdBy}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format timestamp for readability
 */
function formatTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `${diffMins} minutes ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hours ago`;
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toISOString().split('T')[0];
  }
}

/**
 * Extract agent ID from email address
 */
function emailToAgentId(email: string): string | null {
  if (!email.endsWith('@humansent.co')) {
    return null;
  }

  const localPart = email.split('@')[0];

  // Handle external role-player format (e.g., chance-advisor)
  return localPart;
}

/**
 * Try to map Slack user ID to agent ID
 * This is a simplified version - in reality, you'd want a proper mapping table
 */
function slackUserToAgentId(userId: string, context: AgentContext): string | null {
  // Check if any agent has this as a note in their persona
  // For now, return null - this would be improved with a proper mapping
  
  // Try to match by name if userName is available
  const agent = context.otherAgents.find(
    (a) => a.id === userId || a.name.toLowerCase().includes(userId.toLowerCase())
  );

  return agent?.id || null;
}

