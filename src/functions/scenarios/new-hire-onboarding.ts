/**
 * New Hire Onboarding Scenario
 *
 * New engineer starting next week, need to coordinate onboarding.
 */

import { inngest } from '../../index';
import { gmail, llm, db } from '../../services';
import { sam } from '../../agents/leadership/sam';
import { riley } from '../../agents/internal/riley';
import { morgan } from '../../agents/leadership/morgan';
import { casey } from '../../agents/internal/casey';

export const newHireOnboardingScenario = inngest.createFunction(
  {
    id: 'scenario-new-hire-onboarding',
    retries: 1,
  },
  { event: 'scenario/new-hire-onboarding' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'new-hire-onboarding';
    const newHireName = event.data?.name || 'Alex Thompson';
    const startDate = event.data?.startDate || (() => {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      return date.toISOString().split('T')[0];
    })();

    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    const startDateStr = new Date(startDate).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: sam.id,
        fromPersona: {
          name: sam.name,
          role: sam.role,
          communicationStyle: sam.communicationStyle,
          signature: sam.signature,
        },
        toEmail: riley.email,
        scenario: `Sam is preparing for a new engineer (${newHireName}) starting on ${startDateStr}.

The email should:
- Confirm the start date
- Ask Riley to be the onboarding buddy
- List things that need to be ready:
  - Laptop/equipment ordered (CC Casey/Morgan)
  - Accounts created (GitHub, Slack, email)
  - Codebase access and dev environment setup
  - First week schedule/plan
- Suggest they pair on a small starter project
- Ask Riley to prepare a "getting started" doc if one doesn't exist

Keep it practical and organized - Sam's style. Not overly warm but 
making sure the new hire has a great first week.`,
      });
    });

    const sendResult = await step.run('send-email', async () => {
      return gmail.sendEmailWithDryRun(sam.email, {
        to: [riley.email],
        cc: [morgan.email, casey.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: sam.id,
        tickId: 'scenario-seed',
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [riley.email],
          cc: [morgan.email, casey.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: `Scenario seed: New hire onboarding prep for ${newHireName}`,
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      newHire: newHireName,
      startDate,
      description: `Onboarding preparation for ${newHireName} starting ${startDateStr}`,
      expectedBehavior: [
        'Riley confirms and starts prep',
        'Casey/Morgan coordinate equipment',
        'Tasks created for account setup',
        'Discussion about first week plan',
        'Potential Slack announcement draft',
      ],
    };
  }
);

