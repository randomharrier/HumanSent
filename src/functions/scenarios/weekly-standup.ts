/**
 * Weekly Standup Scenario
 *
 * Monday morning - Alex kicks off the weekly leadership sync.
 * Normal, routine scenario to establish baseline communication patterns.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { alex } from '../../agents/leadership/alex';
import { morgan } from '../../agents/leadership/morgan';
import { jordan } from '../../agents/leadership/jordan';
import { sam } from '../../agents/leadership/sam';

export const weeklyStandupScenario = inngest.createFunction(
  {
    id: 'scenario-weekly-standup',
    retries: 1,
  },
  { event: 'scenario/weekly-standup' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'weekly-standup';

    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

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
        scenario: `Alex is sending the weekly Monday morning check-in email to the leadership team.
This is a routine, positive email to kick off the week.

The email should:
- Greet the team warmly
- Ask for quick updates from each leader on their priorities for the week
- Mention 1-2 things Alex is focused on (could be fundraising, product, customer conversations)
- Propose a quick sync call if needed or confirm the standing meeting time
- Keep it brief and energizing - start the week on a good note

This is NOT an emergency. It's a normal Monday morning ritual.`,
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
        tickId: undefined,
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [morgan.email, jordan.email, sam.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: 'Scenario seed: Weekly standup kickoff',
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      description: 'Weekly leadership standup initiated',
      expectedBehavior: [
        'Morgan responds with ops metrics and priorities',
        'Jordan responds with product/customer focus',
        'Sam responds with engineering priorities',
        'Natural back-and-forth about the week ahead',
      ],
    };
  }
);

