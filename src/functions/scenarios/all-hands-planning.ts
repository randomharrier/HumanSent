/**
 * All-Hands Planning Scenario
 *
 * Time to plan the monthly all-hands meeting.
 * Cross-functional coordination scenario.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { alex } from '../../agents/leadership/alex';
import { morgan } from '../../agents/leadership/morgan';
import { jordan } from '../../agents/leadership/jordan';
import { sam } from '../../agents/leadership/sam';

export const allHandsPlanningScenario = inngest.createFunction(
  {
    id: 'scenario-all-hands-planning',
    retries: 1,
  },
  { event: 'scenario/all-hands-planning' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'all-hands-planning';

    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    // Calculate all-hands date (next Friday or in ~2 weeks)
    const allHandsDate = new Date();
    allHandsDate.setDate(allHandsDate.getDate() + 10);
    const dateStr = allHandsDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: alex.id,
        fromPersona: {
          name: alex.name,
          role: alex.role,
          communicationStyle: alex.communicationStyle,
          signature: alex.signature,
        },
        toEmail: morgan.email,
        scenario: `Alex is kicking off planning for the monthly all-hands meeting scheduled for ${dateStr}.

The email should:
- Confirm the date/time for the all-hands
- Ask each leader to prepare a brief update (2-3 min each)
- Mention any special topics Alex wants to cover (company vision, recent wins, challenges)
- Ask if anyone has team members who deserve recognition/shoutouts
- Request agenda items by a specific date (3 days before)
- Keep it collaborative and inclusive

Standard all-hands structure:
1. Alex: Company update, vision, wins
2. Morgan: Ops metrics, scribe network health
3. Jordan: Product updates, customer feedback highlights
4. Sam: Engineering updates, upcoming releases
5. Shoutouts and Q&A

This is a routine but important meeting - good vibes, not stressful.`,
      });
    });

    const sendResult = await step.run('send-email', async () => {
      return gmail.sendEmailWithDryRun(alex.email, {
        to: [morgan.email, jordan.email, sam.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: alex.id,
        tickId: 'scenario-seed',
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [morgan.email, jordan.email, sam.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: 'Scenario seed: All-hands planning kickoff',
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      allHandsDate: allHandsDate.toISOString(),
      description: 'All-hands meeting planning initiated',
      expectedBehavior: [
        'Leaders acknowledge and start preparing updates',
        'Someone might suggest shoutouts for team members',
        'Discussion about agenda topics',
        'Tasks created for preparing slides/updates',
      ],
    };
  }
);

