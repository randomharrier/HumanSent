/**
 * Slack service for reading and sending messages
 *
 * Uses Slack Web API with a bot token.
 * The bot should be installed in the HumanSent workspace with appropriate scopes.
 */

import { WebClient, ChatPostMessageResponse } from '@slack/web-api';
import type { SlackMessage } from '../types';

// ============================================
// Types
// ============================================

interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

interface SlackUser {
  id: string;
  name: string;
  realName: string;
  email?: string;
}

// ============================================
// Client Setup
// ============================================

let slackClient: WebClient | null = null;

function getClient(): WebClient {
  if (!slackClient) {
    const token = process.env.SLACK_BOT_TOKEN;

    if (!token) {
      throw new Error('Missing SLACK_BOT_TOKEN environment variable');
    }

    slackClient = new WebClient(token);
  }

  return slackClient;
}

// ============================================
// Channel Operations
// ============================================

/**
 * List all channels the bot is a member of
 */
export async function listChannels(): Promise<SlackChannel[]> {
  const client = getClient();

  const result = await client.conversations.list({
    types: 'public_channel,private_channel',
    exclude_archived: true,
  });

  return (result.channels || []).map((ch) => ({
    id: ch.id || '',
    name: ch.name || '',
    isPrivate: ch.is_private || false,
    isMember: ch.is_member || false,
  }));
}

/**
 * Get channel ID by name
 */
export async function getChannelIdByName(channelName: string): Promise<string | null> {
  const channels = await listChannels();
  const normalizedName = channelName.replace(/^#/, '');

  const channel = channels.find((ch) => ch.name === normalizedName);
  return channel?.id || null;
}

// ============================================
// User Operations
// ============================================

/**
 * List workspace users (for mapping agent emails to Slack IDs)
 */
export async function listUsers(): Promise<SlackUser[]> {
  const client = getClient();

  const result = await client.users.list({});

  return (result.members || [])
    .filter((m) => !m.is_bot && !m.deleted)
    .map((m) => ({
      id: m.id || '',
      name: m.name || '',
      realName: m.real_name || m.name || '',
      email: m.profile?.email,
    }));
}

/**
 * Get Slack user ID by email
 */
export async function getUserIdByEmail(email: string): Promise<string | null> {
  const client = getClient();

  try {
    const result = await client.users.lookupByEmail({ email });
    return result.user?.id || null;
  } catch {
    // User not found
    return null;
  }
}

// ============================================
// Read Operations
// ============================================

/**
 * Get recent messages from a channel
 */
export async function getChannelMessages(
  channelId: string,
  options?: {
    limit?: number;
    oldest?: string; // Timestamp to start from
  }
): Promise<SlackMessage[]> {
  const client = getClient();

  const result = await client.conversations.history({
    channel: channelId,
    limit: options?.limit ?? 50,
    oldest: options?.oldest,
  });

  const messages: SlackMessage[] = [];

  for (const msg of result.messages || []) {
    if (!msg.ts || msg.subtype) continue; // Skip system messages

    messages.push({
      ts: msg.ts,
      threadTs: msg.thread_ts,
      channel: channelId,
      userId: msg.user || '',
      text: msg.text || '',
      timestamp: new Date(parseFloat(msg.ts) * 1000),
      isThreadReply: !!msg.thread_ts && msg.thread_ts !== msg.ts,
    });
  }

  return messages;
}

/**
 * Get messages from a thread
 */
export async function getThreadMessages(
  channelId: string,
  threadTs: string,
  options?: {
    limit?: number;
  }
): Promise<SlackMessage[]> {
  const client = getClient();

  const result = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: options?.limit ?? 100,
  });

  return (result.messages || [])
    .filter((msg) => !(msg as Record<string, unknown>).subtype)
    .map((msg) => ({
      ts: msg.ts || '',
      threadTs: msg.thread_ts,
      channel: channelId,
      userId: msg.user || '',
      text: msg.text || '',
      timestamp: new Date(parseFloat(msg.ts || '0') * 1000),
      isThreadReply: msg.ts !== threadTs,
    }));
}

/**
 * Get recent messages from multiple channels (for an agent's relevant channels)
 */
export async function getMessagesFromChannels(
  channelIds: string[],
  options?: {
    limitPerChannel?: number;
    hoursBack?: number;
  }
): Promise<SlackMessage[]> {
  const limit = options?.limitPerChannel ?? 20;
  const hoursBack = options?.hoursBack ?? 24;
  const oldest = String((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);

  const allMessages: SlackMessage[] = [];

  // Fetch from all channels in parallel
  const results = await Promise.allSettled(
    channelIds.map((channelId) =>
      getChannelMessages(channelId, { limit, oldest })
    )
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allMessages.push(...result.value);
    }
  }

  // Sort by timestamp descending
  return allMessages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

// ============================================
// Write Operations
// ============================================

/**
 * Post a message to a channel
 */
export async function postMessage(
  channelId: string,
  text: string,
  options?: {
    threadTs?: string;
    username?: string;
    iconEmoji?: string;
  }
): Promise<{ ts: string; channel: string }> {
  const client = getClient();

  const result: ChatPostMessageResponse = await client.chat.postMessage({
    channel: channelId,
    text,
    thread_ts: options?.threadTs,
    username: options?.username,
    icon_emoji: options?.iconEmoji,
  });

  return {
    ts: result.ts || '',
    channel: result.channel || channelId,
  };
}

/**
 * Post a message by channel name (resolves name to ID)
 */
export async function postMessageByChannelName(
  channelName: string,
  text: string,
  options?: {
    threadTs?: string;
    username?: string;
    iconEmoji?: string;
  }
): Promise<{ ts: string; channel: string }> {
  const channelId = await getChannelIdByName(channelName);

  if (!channelId) {
    throw new Error(`Channel not found: ${channelName}`);
  }

  return postMessage(channelId, text, options);
}

/**
 * Reply to a thread
 */
export async function replyToThread(
  channelId: string,
  threadTs: string,
  text: string,
  options?: {
    username?: string;
    iconEmoji?: string;
  }
): Promise<{ ts: string; channel: string }> {
  return postMessage(channelId, text, {
    threadTs,
    ...options,
  });
}

/**
 * Send a DM to a user
 */
export async function sendDirectMessage(
  userId: string,
  text: string
): Promise<{ ts: string; channel: string }> {
  const client = getClient();

  // Open DM channel
  const openResult = await client.conversations.open({
    users: userId,
  });

  const channelId = openResult.channel?.id;
  if (!channelId) {
    throw new Error(`Failed to open DM with user ${userId}`);
  }

  return postMessage(channelId, text);
}

/**
 * Send a DM by email (resolves email to user ID)
 */
export async function sendDirectMessageByEmail(
  email: string,
  text: string
): Promise<{ ts: string; channel: string }> {
  const userId = await getUserIdByEmail(email);

  if (!userId) {
    throw new Error(`User not found with email: ${email}`);
  }

  return sendDirectMessage(userId, text);
}

// ============================================
// Dry Run Mode
// ============================================

/**
 * Check if dry run mode is enabled
 */
export function isDryRunMode(): boolean {
  return process.env.DRY_RUN_MODE === 'true';
}

/**
 * Post message with dry run support
 */
export async function postMessageWithDryRun(
  channelId: string,
  text: string,
  options?: {
    threadTs?: string;
    username?: string;
    iconEmoji?: string;
  }
): Promise<{ ts: string; channel: string; dryRun: boolean }> {
  if (isDryRunMode()) {
    console.warn('[DRY RUN] Would post Slack message:', {
      channel: channelId,
      text: text.slice(0, 100),
      threadTs: options?.threadTs,
    });
    return {
      ts: `dry-run-${Date.now()}`,
      channel: channelId,
      dryRun: true,
    };
  }

  const result = await postMessage(channelId, text, options);
  return { ...result, dryRun: false };
}

// ============================================
// Channel Mapping (for agents)
// ============================================

/**
 * Map of agent IDs to their relevant Slack channels
 */
export const AGENT_CHANNELS: Record<string, string[]> = {
  // Leadership
  alex: ['leadership', 'all-humansent', 'customer-escalations'],
  morgan: ['leadership', 'operations', 'all-humansent'],
  jordan: ['leadership', 'product', 'customer-escalations', 'all-humansent'],
  sam: ['leadership', 'engineering', 'all-humansent'],

  // Internal
  taylor: ['product', 'customer-escalations'],
  riley: ['engineering'],
  casey: ['operations'],

  // External (limited access)
  'chance-advisor': ['leadership'],
  'sarah-investor': [], // Investor doesn't have Slack access typically
  'karen-customer': [], // Customer doesn't have Slack access
  'robert-legal': ['leadership'],
};

/**
 * Get channel IDs for an agent (resolves names to IDs)
 */
export async function getAgentChannelIds(agentId: string): Promise<string[]> {
  const channelNames = AGENT_CHANNELS[agentId] || [];

  const channelIds: string[] = [];
  for (const name of channelNames) {
    const id = await getChannelIdByName(name);
    if (id) {
      channelIds.push(id);
    }
  }

  return channelIds;
}

