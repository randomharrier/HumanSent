/**
 * Team Outing Scenario
 *
 * Casey proposes organizing a team outing/event.
 * Creates positive, culture-building communication.
 */

import { inngest } from '../../index';
import { gmail, llm, db } from '../../services';
import { alex } from '../../agents/leadership/alex';
import { morgan } from '../../agents/leadership/morgan';
import { casey } from '../../agents/internal/casey';

export const teamOutingScenario = inngest.createFunction(
  {
    id: 'scenario-team-outing',
    retries: 1,
  },
  { event: 'scenario/team-outing' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'team-outing';
    const outingType = event.data?.outingType || 'general';

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
        scenario: `Casey wants to propose organizing a team outing or event. 
This is a positive, culture-building initiative.

Ideas could include:
- Team dinner at a nice restaurant
- Escape room or bowling
- Hiking trip
- Happy hour
- Holiday party (if seasonal)

The email should:
- Express enthusiasm for team bonding
- Propose 2-3 specific ideas
- Ask for budget guidance (keep it reasonable for a startup)
- Suggest some potential dates
- CC Alex as an FYI (or ask Morgan if they should)

This is a positive, fun email - not an emergency. Casey is being proactive 
about team culture.`,
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
        reasoning: 'Scenario seed: Team outing proposal',
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      description: 'Team outing proposed by Casey',
      expectedBehavior: [
        'Morgan responds with budget guidance',
        'Alex might chime in with support',
        'Discussion about dates and preferences',
        'Potential Slack discussion to poll the team',
      ],
    };
  }
);

