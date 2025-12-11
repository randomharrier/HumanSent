/**
 * Scribe Crisis Scenario
 *
 * Multiple scribes are out sick, backlog is growing.
 * Operations pressure scenario.
 */

import { inngest } from '../../index';
import { gmail, llm, db } from '../../services';
import { morgan } from '../../agents/leadership/morgan';
import { casey } from '../../agents/internal/casey';
import { alex } from '../../agents/leadership/alex';

export const scribeCrisisScenario = inngest.createFunction(
  {
    id: 'scenario-scribe-crisis',
    retries: 1,
  },
  { event: 'scenario/scribe-crisis' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'scribe-crisis';
    const scribesOut = event.data?.scribesOut || 3;
    const currentBacklog = event.data?.backlog || 847;

    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: casey.id,
        fromPersona: {
          name: casey.name,
          role: casey.role,
          communicationStyle: casey.communicationStyle,
          signature: casey.signature,
        },
        toEmail: morgan.email,
        scenario: `Casey is alerting Morgan to a scribe capacity crisis.

Situation:
- ${scribesOut} scribes are out sick (flu going around)
- Current backlog: ${currentBacklog} cards (up from ~200 yesterday)
- Fulfillment time will hit 9+ days if this continues (normally 5 days)
- These are some of the best/fastest scribes

The email should:
- Be urgent but professional
- Present the facts clearly with numbers
- Flag the impact on fulfillment times
- Mention any enterprise orders at risk
- Ask for guidance on options:
  1. Pause new orders until backlog clears
  2. Bring in untrained scribes (quality risk)
  3. Extend fulfillment time estimates
  4. Reach out to backup scribe network
- Offer to pull together more data if needed

This is a real operational crunch - not panic-inducing but needs quick decisions.`,
      });
    });

    const sendResult = await step.run('send-email', async () => {
      return gmail.sendEmailWithDryRun(casey.email, {
        to: [morgan.email],
        cc: [alex.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: casey.id,
        tickId: 'scenario-seed',
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [morgan.email],
          cc: [alex.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: `Scenario seed: Scribe capacity crisis (${scribesOut} out, ${currentBacklog} backlog)`,
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      scribesOut,
      backlog: currentBacklog,
      description: `Scribe capacity crisis: ${scribesOut} scribes out, ${currentBacklog} card backlog`,
      expectedBehavior: [
        'Morgan responds with decision framework',
        'Alex weighs in on customer communication',
        'Discussion about trade-offs',
        'Tasks created to contact backup scribes',
        'Potential enterprise customer communication',
      ],
    };
  }
);

