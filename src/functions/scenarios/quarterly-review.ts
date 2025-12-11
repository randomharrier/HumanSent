/**
 * Quarterly Review Scenario
 *
 * Time for quarterly business review preparation.
 * Strategic planning and reflection.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { alex } from '../../agents/leadership/alex';
import { morgan } from '../../agents/leadership/morgan';
import { jordan } from '../../agents/leadership/jordan';
import { sam } from '../../agents/leadership/sam';

export const quarterlyReviewScenario = inngest.createFunction(
  {
    id: 'scenario-quarterly-review',
    retries: 1,
  },
  { event: 'scenario/quarterly-review' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'quarterly-review';
    const quarter = event.data?.quarter || 'Q4';

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
        scenario: `Alex is kicking off the ${quarter} quarterly review process.

The email should:
- Acknowledge the quarter is coming to an end
- Request each leader to prepare a brief review:
  - What went well?
  - What could have gone better?
  - Key metrics vs. goals
  - Learnings and adjustments for next quarter
- Set a deadline for initial drafts (1 week)
- Propose a half-day offsite or extended meeting to discuss
- Express genuine interest in reflection and improvement

Tone: Thoughtful, forward-looking, collaborative. Not bureaucratic.

Areas to cover:
- Morgan: Ops efficiency, scribe network health, fulfillment metrics
- Jordan: Product roadmap progress, customer satisfaction, feature launches
- Sam: Technical debt, system reliability, engineering velocity

Alex should mention they'll prepare the company-level view (revenue, growth, runway).`,
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
        reasoning: `Scenario seed: ${quarter} quarterly review kickoff`,
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      quarter,
      description: `${quarter} quarterly review planning initiated`,
      expectedBehavior: [
        'Leaders acknowledge and start gathering data',
        'Discussion about offsite logistics',
        'Questions about specific metrics to include',
        'Tasks created for review preparation',
        'Positive reflection on wins',
      ],
    };
  }
);

