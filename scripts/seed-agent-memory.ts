/**
 * Seed agent memory from recent actions
 * 
 * Analyzes each agent's recent actions and generates initial
 * observations to populate their notes/memory field.
 * 
 * Run with: npx ts-node scripts/seed-agent-memory.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

interface ActionRecord {
  agent_id: string;
  action_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

async function getAgentActions(agentId: string): Promise<ActionRecord[]> {
  const { data, error } = await supabase
    .from('agent_actions')
    .select('agent_id, action_type, payload, created_at')
    .eq('agent_id', agentId)
    .eq('success', true)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data || [];
}

function summarizeActionsForLLM(actions: ActionRecord[]): string {
  if (actions.length === 0) return 'No recent actions.';

  return actions.map((a) => {
    const payload = a.payload;
    const time = new Date(a.created_at).toLocaleString();
    
    switch (a.action_type) {
      case 'send_email':
        return `- ${time}: Sent email to ${(payload.to as string[])?.join(', ')}: "${payload.subject}"`;
      case 'send_slack_message':
        return `- ${time}: Posted in ${payload.channel}: "${(payload.text as string)?.slice(0, 100)}..."`;
      case 'create_task':
        return `- ${time}: Created task "${payload.title}" for ${payload.assignedTo}`;
      case 'no_action':
        return `- ${time}: Decided to take no action: "${payload.reason}"`;
      default:
        return `- ${time}: ${a.action_type}`;
    }
  }).join('\n');
}

async function generateMemoryForAgent(agentId: string, actions: ActionRecord[]): Promise<string[]> {
  const actionSummary = summarizeActionsForLLM(actions);
  
  const prompt = `You are analyzing an AI agent's recent actions to create memory observations.

Agent ID: ${agentId}

Recent actions (newest first):
${actionSummary}

Based on these actions, generate 3-5 concise memory observations that would help this agent remember what they've already done. Focus on:
- Key actions they've completed (introductions, emails sent, topics discussed)
- Ongoing threads or conversations they're part of
- Commitments or follow-ups they've made

Format: Return a JSON array of strings, each 10-20 words.
Example: ["Introduced myself to leadership team on Slack", "Sent check-in email to Alex about legal matters"]

Return ONLY the JSON array, no other text.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  
  try {
    // Parse JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]) as string[];
    }
  } catch (e) {
    console.warn(`Failed to parse memory for ${agentId}:`, e);
  }
  
  return [];
}

async function seedAgentMemory() {
  console.log('Seeding agent memory from recent actions...\n');

  // Get all agents
  const { data: agents, error } = await supabase
    .from('agent_state')
    .select('agent_id, notes')
    .eq('is_active', true);

  if (error) {
    console.error('Error fetching agents:', error);
    return;
  }

  for (const agent of agents || []) {
    console.log(`\n=== ${agent.agent_id} ===`);
    
    // Get recent actions
    const actions = await getAgentActions(agent.agent_id);
    console.log(`Found ${actions.length} recent actions`);

    if (actions.length === 0) {
      console.log('Skipping - no actions to analyze');
      continue;
    }

    // Generate memory observations
    const observations = await generateMemoryForAgent(agent.agent_id, actions);
    console.log('Generated observations:');
    observations.forEach((obs) => console.log(`  - ${obs}`));

    if (observations.length === 0) {
      console.log('Skipping - no observations generated');
      continue;
    }

    // Update agent_state.notes
    const newNotes = {
      observations,
      lastUpdated: new Date().toISOString(),
      seededFrom: 'seed-agent-memory script',
    };

    const { error: updateError } = await supabase
      .from('agent_state')
      .update({ notes: newNotes })
      .eq('agent_id', agent.agent_id);

    if (updateError) {
      console.error(`Error updating ${agent.agent_id}:`, updateError);
    } else {
      console.log('✅ Memory seeded');
    }
  }

  console.log('\n=== Done! ===');
  
  // Verify
  const { data: updated } = await supabase
    .from('agent_state')
    .select('agent_id, notes')
    .eq('is_active', true);

  console.log('\nFinal memory state:');
  for (const agent of updated || []) {
    const notes = agent.notes as { observations?: string[] } | null;
    const count = notes?.observations?.length || 0;
    console.log(`  ${agent.agent_id}: ${count} observations`);
  }
}

seedAgentMemory().catch(console.error);

