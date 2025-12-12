#!/usr/bin/env npx ts-node

/**
 * Test script to manually run a single agent tick
 * 
 * Usage:
 *   npx ts-node scripts/test-tick.ts [agentId]
 * 
 * Example:
 *   npx ts-node scripts/test-tick.ts alex
 */

import { config } from 'dotenv';
config();

import { getAgent, getOtherAgents } from '../src/agents';
import { gmail, slack, llm, db } from '../src/services';
import type { AgentContext, AgentState } from '../src/types/agent';

async function runTestTick(agentId: string) {
  console.log(`\n🤖 Running test tick for agent: ${agentId}\n`);
  console.log('='.repeat(60));

  // Check required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const persona = getAgent(agentId);
  if (!persona) {
    console.error(`❌ Unknown agent: ${agentId}`);
    process.exit(1);
  }

  console.log(`\n👤 Agent: ${persona.name} (${persona.role})`);
  console.log(`   Email: ${persona.email}`);

  // Step 1: Get agent state
  console.log('\n1️⃣  Getting agent state...');
  let state = await db.getAgentState(agentId);
  
  if (!state) {
    console.log('   Creating new agent state...');
    state = await db.upsertAgentState(agentId, persona, { budgetRemaining: 100 });
  }
  console.log(`   Budget: ${state.budgetRemaining}/100`);
  console.log(`   Last tick: ${state.lastTickAt?.toISOString() || 'never'}`);

  // Step 2: Gather context
  console.log('\n2️⃣  Gathering context...');

  // Get Slack messages
  console.log('   Fetching Slack messages...');
  let recentSlackMessages: Awaited<ReturnType<typeof slack.getAndSyncChannelMessages>>['messages'] = [];
  try {
    const channelIds = await slack.getAgentChannelIds(agentId);
    console.log(`   Found ${channelIds.length} channels for ${agentId}`);
    
    if (channelIds.length > 0) {
      const { messages, syncStats } = await slack.getAndSyncChannelMessages(channelIds, {
        limitPerChannel: 20,
        hoursBack: 48,
      });
      recentSlackMessages = messages;
      console.log(`   ✅ Found ${messages.length} Slack messages`);
      console.log(`   ✅ Synced ${syncStats.messagesSynced} to Supabase`);
    }
  } catch (error) {
    console.error('   ❌ Failed to fetch Slack:', error);
  }

  // Get emails (might fail without Gmail setup)
  console.log('   Fetching emails...');
  let recentEmails: Awaited<ReturnType<typeof gmail.getRecentEmails>> = [];
  try {
    recentEmails = await gmail.getRecentEmails(persona.email, {
      maxResults: 10,
      includeRead: false,
      hoursBack: 48,
    });
    console.log(`   ✅ Found ${recentEmails.length} emails`);
  } catch (error) {
    console.log(`   ⚠️ Email fetch failed (likely no Gmail setup): ${error instanceof Error ? error.message : error}`);
  }

  // Get open tasks
  const openTasks = await db.getOpenTasks(agentId);
  console.log(`   ✅ Found ${openTasks.length} open tasks`);

  // Build context
  const context: AgentContext = {
    agent: persona,
    state,
    recentEmails,
    recentSlackMessages,
    openTasks,
    currentTime: new Date(),
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    isBusinessHours: true,
    otherAgents: getOtherAgents(agentId),
  };

  // Show what the agent sees
  console.log('\n3️⃣  Context summary:');
  console.log(`   📧 Emails: ${context.recentEmails.length}`);
  console.log(`   💬 Slack messages: ${context.recentSlackMessages.length}`);
  console.log(`   📋 Open tasks: ${context.openTasks.length}`);
  
  if (context.recentSlackMessages.length > 0) {
    console.log('\n   Recent Slack messages:');
    for (const msg of context.recentSlackMessages.slice(0, 5)) {
      const preview = msg.text.slice(0, 60).replace(/\n/g, ' ');
      console.log(`   - [#${msg.channelName || msg.channel}] ${preview}...`);
    }
  }

  // Step 3: Get LLM decision
  console.log('\n4️⃣  Getting LLM decision...');
  
  try {
    const llmResponse = await llm.getAgentDecision(context);
    
    console.log(`\n   Model: ${llmResponse.model}`);
    console.log(`   Tokens: ${llmResponse.promptTokens} prompt, ${llmResponse.completionTokens} completion`);
    console.log(`   Latency: ${llmResponse.latencyMs}ms`);
    
    console.log('\n   📝 Reasoning:');
    const reasoning = llmResponse.output.reasoning;
    if (reasoning) {
      console.log(`   - Highest priority: ${reasoning.highestPriority}`);
      console.log(`   - Budget assessment: ${reasoning.budgetAssessment}`);
      if (reasoning.observations) {
        console.log(`   - Observations: ${reasoning.observations}`);
      }
    } else {
      console.log('   (no reasoning provided)');
    }
    
    console.log(`\n   🎯 Actions planned: ${llmResponse.output.actions.length}`);
    for (const action of llmResponse.output.actions) {
      console.log(`\n   Action: ${action.type}`);
      if (action.type === 'send_slack_message') {
        console.log(`     Channel: ${action.channel}`);
        console.log(`     Text: ${action.text.slice(0, 100)}...`);
      } else if (action.type === 'send_email') {
        console.log(`     To: ${action.to.join(', ')}`);
        console.log(`     Subject: ${action.subject}`);
      } else if (action.type === 'no_action') {
        console.log(`     Reason: ${action.reason}`);
      } else {
        console.log(`     Details: ${JSON.stringify(action).slice(0, 100)}...`);
      }
    }

    // Execute actions if --execute flag is provided
    const shouldExecute = process.argv.includes('--execute');
    
    if (shouldExecute && llmResponse.output.actions.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('\n🚀 EXECUTING ACTIONS...\n');
      
      for (const action of llmResponse.output.actions) {
        try {
          if (action.type === 'send_slack_message') {
            // Resolve channel name to ID
            let channelId = action.channel;
            if (action.channel.startsWith('#')) {
              const resolved = await slack.getChannelIdByName(action.channel.replace('#', ''));
              if (!resolved) {
                console.log(`   ❌ Channel not found: ${action.channel}`);
                continue;
              }
              channelId = resolved;
            }
            
            const result = await slack.postMessage(channelId, action.text, {
              username: persona.name,
              threadTs: action.threadTs,
            });
            console.log(`   ✅ Slack message sent to ${action.channel} (ts: ${result.ts})`);
            
            // Log the action
            await db.logAgentAction({
              agentId,
              actionType: action.type,
              payload: { ...action, result },
              success: true,
            });
            
          } else if (action.type === 'send_email') {
            console.log(`   ⚠️ Skipping email (Gmail not configured): ${action.subject}`);
            
          } else if (action.type === 'no_action') {
            console.log(`   ℹ️ No action: ${action.reason}`);
            await db.logAgentAction({
              agentId,
              actionType: action.type,
              payload: action,
              success: true,
            });
            
          } else {
            console.log(`   ⚠️ Action type not implemented in test: ${action.type}`);
          }
        } catch (error) {
          console.error(`   ❌ Failed to execute ${action.type}:`, error);
        }
      }
      
      // Update agent state
      await db.upsertAgentState(agentId, persona, {
        lastTickAt: new Date(),
        budgetRemaining: Math.max(0, state.budgetRemaining - 5), // Slack costs 5
      });
      console.log('\n   ✅ Agent state updated');
      
    } else if (!shouldExecute) {
      console.log('\n' + '='.repeat(60));
      console.log('\n⚠️  This was a DRY RUN. Actions were NOT executed.');
      console.log('To execute actions, run:');
      console.log(`   npx ts-node scripts/test-tick.ts ${agentId} --execute`);
    }
    
  } catch (error) {
    console.error('\n❌ LLM decision failed:', error);
  }

  console.log('\n');
}

// Main
const agentId = process.argv[2] || 'alex';
runTestTick(agentId).catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
