#!/usr/bin/env npx ts-node

/**
 * HumanSent Agents Control Script
 * 
 * Usage:
 *   npx ts-node scripts/control.ts <command> [options]
 * 
 * Commands:
 *   status              Show agent status and recent activity
 *   tick [agentId]      Trigger a tick for one or all agents
 *   scenario <name>     Trigger a scenario
 *   list-scenarios      List available scenarios
 *   pause               Pause all agent activity (set DRY_RUN_MODE)
 *   resume              Resume agent activity
 */

import { config } from 'dotenv';
config(); // Load .env file

const INNGEST_EVENT_KEY = process.env.INNGEST_EVENT_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ============================================
// Available Scenarios
// ============================================

const SCENARIOS = {
  // Emergency/Pressure scenarios
  'karen-meltdown': {
    name: 'scenario/karen-meltdown',
    description: 'Customer escalation - Karen complains about photo camera issue',
    category: 'emergency',
  },
  'legal-subpoena': {
    name: 'scenario/legal-subpoena',
    description: 'Legal receives subpoena for customer data',
    category: 'emergency',
  },
  'investor-pressure': {
    name: 'scenario/investor-pressure',
    description: 'Sarah requests board deck with deadline',
    category: 'pressure',
  },
  'scribe-crisis': {
    name: 'scenario/scribe-crisis',
    description: 'Multiple scribes out sick, backlog growing',
    category: 'emergency',
  },

  // Normal everyday scenarios
  'weekly-standup': {
    name: 'scenario/weekly-standup',
    description: 'Monday morning - time for weekly leadership sync',
    category: 'routine',
  },
  'expense-reports': {
    name: 'scenario/expense-reports',
    description: 'Finance reminds team expense reports are due',
    category: 'routine',
  },
  'all-hands-planning': {
    name: 'scenario/all-hands-planning',
    description: 'Time to plan the monthly all-hands meeting',
    category: 'planning',
  },
  'team-outing': {
    name: 'scenario/team-outing',
    description: 'Casey proposes organizing a team outing',
    category: 'culture',
  },
  'new-hire-onboarding': {
    name: 'scenario/new-hire-onboarding',
    description: 'New engineer starting next week, need to prep',
    category: 'hiring',
  },
  'interview-scheduling': {
    name: 'scenario/interview-scheduling',
    description: 'Strong candidate for product role needs interviews',
    category: 'hiring',
  },
  'quarterly-review': {
    name: 'scenario/quarterly-review',
    description: 'Time for quarterly business review prep',
    category: 'planning',
  },
  'feature-launch': {
    name: 'scenario/feature-launch',
    description: 'New feature ready to launch, need coordination',
    category: 'product',
  },
  'customer-win': {
    name: 'scenario/customer-win',
    description: 'Big enterprise customer signed! Celebrate and plan',
    category: 'positive',
  },
  'advisor-checkin': {
    name: 'scenario/advisor-checkin',
    description: 'Chance reaches out for monthly advisory check-in',
    category: 'routine',
  },
} as const;

// ============================================
// Inngest API Helper
// ============================================

async function sendInngestEvent(eventName: string, data: Record<string, unknown> = {}) {
  if (!INNGEST_EVENT_KEY) {
    console.error('❌ INNGEST_EVENT_KEY not set. Add it to .env file.');
    process.exit(1);
  }

  const response = await fetch(`https://inn.gs/e/${INNGEST_EVENT_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: eventName, data }),
  });

  if (!response.ok) {
    throw new Error(`Inngest API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============================================
// Supabase Helper
// ============================================

async function querySupabase(query: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_KEY not set.');
    process.exit(1);
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query }),
  });

  return response.json();
}

async function getAgentStatus() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_KEY not set.');
    return null;
  }

  // Get agent states
  const statesResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_state?select=agent_id,is_active,budget_remaining,last_tick_at&order=agent_id`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  const states = await statesResponse.json();

  // Get recent actions count
  const actionsResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_actions?select=agent_id&created_at=gte.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  const actions = await actionsResponse.json();

  // Count actions per agent
  const actionCounts: Record<string, number> = {};
  if (Array.isArray(actions)) {
    for (const action of actions) {
      actionCounts[action.agent_id] = (actionCounts[action.agent_id] || 0) + 1;
    }
  }

  return { states, actionCounts };
}

// ============================================
// Commands
// ============================================

async function showStatus() {
  console.log('\n🤖 HumanSent Agents Status\n');
  console.log('='.repeat(60));

  const status = await getAgentStatus();
  
  if (!status || !Array.isArray(status.states)) {
    console.log('Unable to fetch status. Check Supabase credentials.\n');
    return;
  }

  console.log('\nAgent                    Active  Budget  Last Tick           Actions (24h)');
  console.log('-'.repeat(75));

  for (const agent of status.states) {
    const lastTick = agent.last_tick_at 
      ? new Date(agent.last_tick_at).toLocaleString()
      : 'Never';
    const actions = status.actionCounts[agent.agent_id] || 0;
    
    console.log(
      `${agent.agent_id.padEnd(24)} ${agent.is_active ? '✅' : '❌'}      ${String(agent.budget_remaining).padEnd(6)}  ${lastTick.padEnd(20)} ${actions}`
    );
  }

  console.log('\n');
}

async function triggerTick(agentId?: string) {
  if (agentId) {
    console.log(`\n🔄 Triggering tick for agent: ${agentId}...`);
    await sendInngestEvent('agent/tick', { agentId, force: true });
    console.log(`✅ Tick triggered for ${agentId}\n`);
  } else {
    console.log('\n🔄 Triggering tick for ALL agents...');
    await sendInngestEvent('agent/tick.all', { force: true });
    console.log('✅ Tick triggered for all agents\n');
  }
}

async function triggerScenario(scenarioKey: string, options: Record<string, unknown> = {}) {
  const scenario = SCENARIOS[scenarioKey as keyof typeof SCENARIOS];
  
  if (!scenario) {
    console.error(`\n❌ Unknown scenario: ${scenarioKey}`);
    console.log('\nAvailable scenarios:');
    listScenarios();
    process.exit(1);
  }

  console.log(`\n🎬 Triggering scenario: ${scenarioKey}`);
  console.log(`   ${scenario.description}`);
  
  await sendInngestEvent(scenario.name, options);
  
  console.log('✅ Scenario triggered!\n');
  console.log('The seed event has been sent. Agents will react on their next tick.');
  console.log('Run "npx ts-node scripts/control.ts tick" to trigger immediate ticks.\n');
}

function listScenarios() {
  console.log('\n📋 Available Scenarios\n');
  console.log('='.repeat(60));

  const categories = ['emergency', 'pressure', 'routine', 'planning', 'hiring', 'culture', 'product', 'positive'];
  
  for (const category of categories) {
    const categoryScenarios = Object.entries(SCENARIOS).filter(
      ([_, s]) => s.category === category
    );
    
    if (categoryScenarios.length > 0) {
      console.log(`\n${category.toUpperCase()}:`);
      for (const [key, scenario] of categoryScenarios) {
        console.log(`  ${key.padEnd(22)} - ${scenario.description}`);
      }
    }
  }
  
  console.log('\n');
  console.log('Usage: npx ts-node scripts/control.ts scenario <name>');
  console.log('Example: npx ts-node scripts/control.ts scenario team-outing\n');
}

async function pauseAgents() {
  console.log('\n⏸️  Pausing all agents...\n');
  console.log('To pause agents, you have two options:\n');
  
  console.log('Option 1: Inngest Dashboard (Recommended)');
  console.log('  1. Go to https://app.inngest.com');
  console.log('  2. Navigate to your app → Functions');
  console.log('  3. Find "agent-tick-all" and click "Pause"\n');
  
  console.log('Option 2: Set DRY_RUN_MODE');
  console.log('  In Railway (or .env), set: DRY_RUN_MODE=true');
  console.log('  Agents will "tick" but won\'t send real emails/Slack\n');
  
  console.log('Option 3: Disable specific agents');
  console.log('  Set: DISABLED_AGENTS=alex,morgan,jordan,...\n');

  // Try to deactivate all agents in Supabase
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    console.log('Deactivating agents in database...');
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_state?is_active=eq.true`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ is_active: false }),
      }
    );

    if (response.ok) {
      console.log('✅ All agents marked as inactive in database');
      console.log('   They will skip their ticks until resumed.\n');
    } else {
      console.log('⚠️  Could not update database. Use Inngest dashboard instead.\n');
    }
  }
}

async function resumeAgents() {
  console.log('\n▶️  Resuming all agents...\n');
  
  // Reactivate all agents in Supabase
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    console.log('Reactivating agents in database...');
    
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_state?is_active=eq.false`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ is_active: true }),
      }
    );

    if (response.ok) {
      console.log('✅ All agents reactivated in database\n');
    } else {
      console.log('⚠️  Could not update database.\n');
    }
  }

  console.log('If you paused via Inngest Dashboard:');
  console.log('  1. Go to https://app.inngest.com');
  console.log('  2. Navigate to your app → Functions');
  console.log('  3. Find "agent-tick-all" and click "Resume"\n');
  
  console.log('If you set DRY_RUN_MODE=true:');
  console.log('  Set it back to: DRY_RUN_MODE=false\n');
}

function showHelp() {
  console.log(`
🤖 HumanSent Agents Control Script

Usage:
  npx ts-node scripts/control.ts <command> [options]

Commands:
  status                    Show agent status and recent activity
  tick [agentId]            Trigger a tick for one or all agents
  scenario <name>           Trigger a scenario
  list-scenarios            List available scenarios
  pause                     Stop all agent activity
  resume                    Resume agent activity
  help                      Show this help message

Examples:
  npx ts-node scripts/control.ts status
  npx ts-node scripts/control.ts tick
  npx ts-node scripts/control.ts tick alex
  npx ts-node scripts/control.ts scenario karen-meltdown
  npx ts-node scripts/control.ts scenario team-outing
  npx ts-node scripts/control.ts list-scenarios
  npx ts-node scripts/control.ts pause
  npx ts-node scripts/control.ts resume

Environment:
  Make sure you have a .env file with:
  - INNGEST_EVENT_KEY
  - SUPABASE_URL
  - SUPABASE_SERVICE_KEY
`);
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'status':
      await showStatus();
      break;

    case 'tick':
      await triggerTick(args[1]);
      break;

    case 'scenario':
      if (!args[1]) {
        console.error('\n❌ Please specify a scenario name.');
        listScenarios();
        process.exit(1);
      }
      await triggerScenario(args[1]);
      break;

    case 'list-scenarios':
    case 'scenarios':
      listScenarios();
      break;

    case 'pause':
    case 'stop':
      await pauseAgents();
      break;

    case 'resume':
    case 'start':
      await resumeAgents();
      break;

    case 'help':
    case '--help':
    case '-h':
    default:
      showHelp();
      break;
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

