/**
 * Backfill messages table from agent_actions
 * 
 * This script reads all send_slack_message and send_email actions
 * and creates corresponding entries in the messages table with
 * proper from_agent attribution.
 * 
 * Run with: npx ts-node scripts/backfill-messages.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface ActionPayload {
  type: string;
  text?: string;
  channel?: string;
  threadTs?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  result?: {
    ts?: string;
    channel?: string;
    dryRun?: boolean;
    messageId?: string;
    threadId?: string;
  };
}

interface AgentAction {
  id: string;
  agent_id: string;
  action_type: string;
  payload: ActionPayload;
  created_at: string;
}

async function backfillMessages() {
  console.log('Starting backfill of messages table from agent_actions...\n');

  // Fetch all send actions
  const { data: actions, error: fetchError } = await supabase
    .from('agent_actions')
    .select('id, agent_id, action_type, payload, created_at')
    .in('action_type', ['send_slack_message', 'send_email'])
    .eq('success', true)
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('Error fetching actions:', fetchError);
    return;
  }

  console.log(`Found ${actions?.length || 0} send actions to process\n`);

  let slackCount = 0;
  let emailCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const action of (actions as AgentAction[]) || []) {
    try {
      const payload = action.payload;
      const result = payload.result;

      // Skip dry runs
      if (result?.dryRun) {
        skipCount++;
        continue;
      }

      if (action.action_type === 'send_slack_message') {
        // Handle Slack message
        const ts = result?.ts;
        const channelId = result?.channel || payload.channel?.replace('#', '');
        const channelName = payload.channel?.replace('#', '') || 'unknown';

        if (!ts || !channelId) {
          console.warn(`Skipping Slack action ${action.id}: missing ts or channel`);
          skipCount++;
          continue;
        }

        const messageId = `slack:${channelId}:${ts}`;
        const conversationId = payload.threadTs
          ? `slack:${channelId}:${payload.threadTs}`
          : messageId;

        // Upsert conversation
        await supabase.from('conversations').upsert({
          id: conversationId,
          type: 'slack',
          subject: `#${channelName}`,
          participants: [action.agent_id],
          last_activity_at: action.created_at,
          message_count: 1,
          metadata: { channelName, channelId },
        }, { onConflict: 'id' });

        // Upsert message
        await supabase.from('messages').upsert({
          id: messageId,
          conversation_id: conversationId,
          type: 'slack',
          from_agent: action.agent_id,
          body_preview: (payload.text || '').slice(0, 500),
          full_body: payload.text,
          timestamp: action.created_at,
          is_read: true,
          metadata: {
            channel: channelId,
            channelName,
            ts,
            threadTs: payload.threadTs,
          },
        }, { onConflict: 'id' });

        slackCount++;
      } else if (action.action_type === 'send_email') {
        // Handle email
        const messageId = result?.messageId;
        const threadId = result?.threadId;

        if (!messageId) {
          console.warn(`Skipping email action ${action.id}: missing messageId`);
          skipCount++;
          continue;
        }

        const conversationId = `email:${threadId || messageId}`;

        // Extract recipient agent IDs
        const toAgents = (payload.to || [])
          .filter((email: string) => email.endsWith('@humansent.co'))
          .map((email: string) => email.replace('@humansent.co', ''));

        // Upsert conversation
        await supabase.from('conversations').upsert({
          id: conversationId,
          type: 'email',
          subject: payload.subject,
          participants: [action.agent_id, ...toAgents],
          last_activity_at: action.created_at,
          message_count: 1,
          metadata: { threadId },
        }, { onConflict: 'id' });

        // Upsert message
        await supabase.from('messages').upsert({
          id: `email:${messageId}`,
          conversation_id: conversationId,
          type: 'email',
          from_agent: action.agent_id,
          to_agents: toAgents.length > 0 ? toAgents : null,
          subject: payload.subject,
          body_preview: (payload.body || '').slice(0, 500),
          full_body: payload.body,
          timestamp: action.created_at,
          is_read: false,
          metadata: {
            messageId,
            threadId,
            to: payload.to,
            cc: payload.cc,
          },
        }, { onConflict: 'id' });

        emailCount++;
      }
    } catch (err) {
      console.error(`Error processing action ${action.id}:`, err);
      errorCount++;
    }
  }

  console.log('\n=== Backfill Complete ===');
  console.log(`Slack messages: ${slackCount}`);
  console.log(`Email messages: ${emailCount}`);
  console.log(`Skipped: ${skipCount}`);
  console.log(`Errors: ${errorCount}`);

  // Verify the results
  const { data: msgCount } = await supabase
    .from('messages')
    .select('from_agent', { count: 'exact' });

  const counts: Record<string, number> = {};
  (msgCount || []).forEach((m: { from_agent: string | null }) => {
    const key = m.from_agent || 'null';
    counts[key] = (counts[key] || 0) + 1;
  });

  console.log('\n=== Message Attribution After Backfill ===');
  console.log(counts);
}

backfillMessages().catch(console.error);

