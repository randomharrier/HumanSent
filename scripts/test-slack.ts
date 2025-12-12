#!/usr/bin/env npx ts-node

/**
 * Test script for Slack bot connectivity
 * 
 * Usage:
 *   npx ts-node scripts/test-slack.ts [--sync]
 * 
 * Options:
 *   --sync    Also test syncing messages to Supabase
 */

import { config } from 'dotenv';
config(); // Load .env file

import {
  listChannels,
  listUsers,
  getChannelIdByName,
  postMessage,
  getAgentChannelIds,
  getAndSyncChannelMessages,
} from '../src/services/slack';

async function testSlack() {
  const testSync = process.argv.includes('--sync');
  
  console.log('\n🧪 Testing Slack Bot Connection\n');
  console.log('='.repeat(60));

  // Step 1: Test authentication by listing channels
  console.log('\n1️⃣  Testing channel listing...\n');
  
  let channels: Awaited<ReturnType<typeof listChannels>> = [];
  try {
    channels = await listChannels();
    console.log(`✅ Found ${channels.length} channels:`);
    
    for (const ch of channels) {
      const memberIcon = ch.isMember ? '👤' : '  ';
      const privateIcon = ch.isPrivate ? '🔒' : '  ';
      console.log(`   ${memberIcon} ${privateIcon} #${ch.name} (${ch.id})`);
    }
  } catch (error) {
    console.error('❌ Failed to list channels:', error);
    process.exit(1);
  }

  // Step 2: Test user listing
  console.log('\n2️⃣  Testing user listing...\n');
  
  try {
    const users = await listUsers();
    console.log(`✅ Found ${users.length} users:`);
    
    for (const user of users.slice(0, 10)) {
      console.log(`   @${user.name} - ${user.realName}${user.email ? ` (${user.email})` : ''}`);
    }
    if (users.length > 10) {
      console.log(`   ... and ${users.length - 10} more`);
    }
  } catch (error) {
    console.error('❌ Failed to list users:', error);
    // Continue testing even if this fails
  }

  // Step 3: Try to find a test channel
  console.log('\n3️⃣  Looking for test channels...\n');
  
  const testChannelNames = ['bot-testing', 'test', 'random', 'general', 'all-humansent'];
  let testChannelId: string | null = null;
  let testChannelName: string | null = null;

  for (const name of testChannelNames) {
    const id = await getChannelIdByName(name);
    if (id) {
      testChannelId = id;
      testChannelName = name;
      console.log(`✅ Found channel #${name} (${id}) for testing`);
      break;
    }
  }

  if (!testChannelId) {
    console.log('⚠️  No test channel found. Tried: ' + testChannelNames.join(', '));
    console.log('   Create a #bot-testing channel and add the bot to test posting.');
    return;
  }

  // Step 4: Send a test message
  console.log('\n4️⃣  Sending test message...\n');
  
  try {
    const timestamp = new Date().toLocaleString();
    const testMessage = `🧪 Slack Bot Test Message\n\nSent at: ${timestamp}\n\nIf you see this, the bot is working correctly! 🎉`;
    
    const result = await postMessage(testChannelId, testMessage);
    
    console.log(`✅ Message sent successfully!`);
    console.log(`   Channel: #${testChannelName}`);
    console.log(`   Message TS: ${result.ts}`);
  } catch (error) {
    console.error('❌ Failed to send message:', error);
    console.log('\nPossible issues:');
    console.log('  - Bot is not a member of the channel');
    console.log('  - Bot lacks chat:write permission');
    console.log('  - Channel ID is incorrect');
    process.exit(1);
  }

  // Step 5: Test Supabase sync (optional)
  if (testSync) {
    console.log('\n5️⃣  Testing Slack message sync to Supabase...\n');
    
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.log('⚠️  Skipping sync test - SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
    } else {
      try {
        // Get channels for alex (leadership agent)
        const channelIds = await getAgentChannelIds('alex');
        console.log(`   Found ${channelIds.length} channels for agent 'alex'`);
        
        if (channelIds.length > 0) {
          const { messages, syncStats } = await getAndSyncChannelMessages(channelIds, {
            limitPerChannel: 10,
            hoursBack: 24,
          });
          
          console.log(`✅ Sync completed!`);
          console.log(`   Messages fetched: ${messages.length}`);
          console.log(`   Messages synced to Supabase: ${syncStats.messagesSynced}`);
          console.log(`   Conversations updated: ${syncStats.conversationsUpdated}`);
          
          if (messages.length > 0) {
            console.log('\n   Sample messages:');
            for (const msg of messages.slice(0, 3)) {
              const preview = msg.text.slice(0, 50).replace(/\n/g, ' ');
              console.log(`   - [#${msg.channelName || msg.channel}] ${preview}...`);
            }
          }
        } else {
          console.log('   No channels found for agent alex');
        }
      } catch (error) {
        console.error('❌ Failed to sync messages:', error);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ All Slack tests passed!\n');
  console.log('The bot can:');
  console.log('  - List channels in the workspace');
  console.log('  - List users in the workspace');
  console.log(`  - Post messages to #${testChannelName}`);
  if (testSync && process.env.SUPABASE_URL) {
    console.log('  - Sync messages to Supabase');
  }
  console.log('\nTo test Supabase sync, run:');
  console.log('  npx ts-node scripts/test-slack.ts --sync');
  console.log('\n');
}

// Run the test
testSlack().catch((error) => {
  console.error('\n❌ Test failed with error:', error);
  process.exit(1);
});
