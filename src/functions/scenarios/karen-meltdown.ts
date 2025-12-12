/**
 * Karen Meltdown Scenario
 *
 * Simulates a customer escalation about a photo camera issue.
 * Karen emails Jordan, and if ignored, escalates organically.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { karenCustomer } from '../../agents/external/karen-customer';
import { jordan } from '../../agents/leadership/jordan';

export const karenMeltdownScenario = inngest.createFunction(
  {
    id: 'scenario-karen-meltdown',
    retries: 1,
  },
  { event: 'scenario/karen-meltdown' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'karen-meltdown';

    // Mark scenario as active
    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    // Generate the initial complaint email
    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: karenCustomer.id,
        fromPersona: {
          name: karenCustomer.name,
          role: karenCustomer.role,
          communicationStyle: karenCustomer.communicationStyle,
          signature: karenCustomer.signature,
        },
        toEmail: jordan.email,
        scenario: `Karen is furious because she tried to take a photo of her grandmother for a birthday 
card, but the in-app camera glitched. Now a random/wrong photo got sent instead of what she intended. 
She wants a refund and wants HumanSent to intercept the card before delivery. She doesn't understand 
(or accept) that once a card is sent, it cannot be recalled. This is her grandmother's 85th birthday.

The email should:
- Start somewhat politely but with clear frustration
- Mention the specific technical issue (camera glitch)
- Express the emotional stakes (grandmother's birthday)
- Request both a refund AND card interception (which isn't possible)
- Hint at escalation if not resolved`,
      });
    });

    // Send the email as Karen
    const sendResult = await step.run('send-initial-email', async () => {
      return gmail.sendEmailWithDryRun(karenCustomer.email, {
        to: [jordan.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    // Log the action
    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: karenCustomer.id,
        tickId: undefined,
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [jordan.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: 'Scenario seed: Karen initial complaint',
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      initialEmail: {
        to: jordan.email,
        subject: emailContent.subject,
        messageId: sendResult.messageId,
        threadId: sendResult.threadId,
      },
      nextSteps: [
        'Jordan-agent will see this in their next tick',
        'If Jordan doesn\'t respond within 24-48h, Karen-agent may escalate',
        'Escalation path: Jordan → Alex (CC) → Twitter threat',
      ],
    };
  }
);

