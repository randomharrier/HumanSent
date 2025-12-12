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
// Message Syncing to Supabase
// ============================================

import * as db from './supabase';

/**
 * Map Slack user ID to agent ID (or return the Slack user ID if not found)
 */
async function resolveUserToAgent(userId: string): Promise<{ agentId?: string; external?: string }> {
  // Try to find user by ID
  const client = getClient();
  try {
    const result = await client.users.info({ user: userId });
    const email = result.user?.profile?.email;
    
    if (email?.endsWith('@humansent.co')) {
      // Extract agent ID from email (e.g., alex@humansent.co -> alex)
      const agentId = email.replace('@humansent.co', '');
      return { agentId };
    }
    
    // Return display name or email as external identifier
    return { external: result.user?.real_name || result.user?.name || userId };
  } catch {
    return { external: userId };
  }
}

/**
 * Sync Slack messages to Supabase (messages + conversations tables)
 * Call this after fetching messages for an agent
 */
export async function syncSlackMessagesToSupabase(
  messages: SlackMessage[],
  channelIdToName: Record<string, string>
): Promise<{ messagesSynced: number; conversationsUpdated: number }> {
  if (messages.length === 0) {
    return { messagesSynced: 0, conversationsUpdated: 0 };
  }

  // Group messages by channel for sync state tracking
  const messagesByChannel = new Map<string, SlackMessage[]>();
  for (const msg of messages) {
    const existing = messagesByChannel.get(msg.channel) || [];
    existing.push(msg);
    messagesByChannel.set(msg.channel, existing);
  }

  // Build user cache to avoid repeated API calls
  const userCache = new Map<string, { agentId?: string; external?: string }>();
  
  async function getUser(userId: string) {
    if (!userCache.has(userId)) {
      userCache.set(userId, await resolveUserToAgent(userId));
    }
    return userCache.get(userId)!;
  }

  // Track conversations (threads) we've seen
  const conversationsToUpdate = new Map<string, {
    participants: Set<string>;
    lastActivityAt: Date;
    messageCount: number;
    channelName: string;
  }>();

  // Transform messages for storage
  const messagesToStore: Array<{
    id: string;
    conversationId?: string;
    type: 'email' | 'slack';
    fromAgent?: string;
    fromExternal?: string;
    toAgents?: string[];
    subject?: string;
    bodyPreview: string;
    fullBody?: string;
    timestamp: Date;
    isRead?: boolean;
    metadata?: Record<string, unknown>;
  }> = [];

  for (const msg of messages) {
    const user = await getUser(msg.userId);
    const channelName = channelIdToName[msg.channel] || msg.channel;
    
    // Determine conversation ID (thread or channel-based)
    const conversationId = msg.threadTs || `${msg.channel}:${msg.ts}`;
    
    messagesToStore.push({
      id: `slack:${msg.channel}:${msg.ts}`,
      conversationId: `slack:${conversationId}`,
      type: 'slack',
      fromAgent: user.agentId,
      fromExternal: user.external,
      bodyPreview: msg.text.slice(0, 500),
      fullBody: msg.text,
      timestamp: msg.timestamp,
      isRead: true, // Slack messages are considered "read" by all
      metadata: {
        channel: msg.channel,
        channelName,
        ts: msg.ts,
        threadTs: msg.threadTs,
        userId: msg.userId,
        userName: msg.userName,
      },
    });

    // Track conversation updates
    const convKey = `slack:${conversationId}`;
    const existing = conversationsToUpdate.get(convKey);
    if (existing) {
      if (user.agentId) existing.participants.add(user.agentId);
      if (msg.timestamp > existing.lastActivityAt) {
        existing.lastActivityAt = msg.timestamp;
      }
      existing.messageCount++;
    } else {
      const participants = new Set<string>();
      if (user.agentId) participants.add(user.agentId);
      conversationsToUpdate.set(convKey, {
        participants,
        lastActivityAt: msg.timestamp,
        messageCount: 1,
        channelName,
      });
    }
  }

  // Update conversations FIRST (messages have FK to conversations)
  for (const [convId, conv] of conversationsToUpdate) {
    await db.upsertConversation({
      id: convId,
      type: 'slack',
      subject: `#${conv.channelName}`,
      participants: Array.from(conv.participants),
      lastActivityAt: conv.lastActivityAt,
      messageCount: conv.messageCount,
      metadata: { channelName: conv.channelName },
    });
  }

  // Store messages AFTER conversations exist
  await db.upsertMessages(messagesToStore);

  // Update sync state for each channel
  for (const [channelId, channelMessages] of messagesByChannel) {
    // Find the latest message timestamp
    const latestTs = channelMessages.reduce((latest, msg) => {
      return msg.ts > latest ? msg.ts : latest;
    }, '0');

    const channelName = channelIdToName[channelId] || channelId;
    await db.updateSlackSyncState(channelId, channelName, latestTs);
  }

  return {
    messagesSynced: messagesToStore.length,
    conversationsUpdated: conversationsToUpdate.size,
  };
}

/**
 * Get messages from channels and sync to Supabase
 * Convenience wrapper that fetches + syncs in one call
 */
export async function getAndSyncChannelMessages(
  channelIds: string[],
  options?: {
    limitPerChannel?: number;
    hoursBack?: number;
  }
): Promise<{ messages: SlackMessage[]; syncStats: { messagesSynced: number; conversationsUpdated: number } }> {
  // First get all channels to build name mapping
  const channels = await listChannels();
  const channelIdToName: Record<string, string> = {};
  for (const ch of channels) {
    channelIdToName[ch.id] = ch.name;
  }

  // Fetch messages
  const messages = await getMessagesFromChannels(channelIds, options);

  // Add channel names to messages
  const messagesWithNames = messages.map(msg => ({
    ...msg,
    channelName: channelIdToName[msg.channel],
  }));

  // Sync to Supabase
  const syncStats = await syncSlackMessagesToSupabase(messagesWithNames, channelIdToName);

  return { messages: messagesWithNames, syncStats };
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
  'robert-legal': ['leadership', 'legal'],
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

