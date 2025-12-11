/**
 * Investor Pressure Scenario
 *
 * Simulates board deck deadline pressure and metrics requests.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { sarahInvestor } from '../../agents/external/sarah-investor';
import { alex } from '../../agents/leadership/alex';

export const investorPressureScenario = inngest.createFunction(
  {
    id: 'scenario-investor-pressure',
    retries: 1,
  },
  { event: 'scenario/investor-pressure' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'investor-pressure';

    // Calculate deadline (default: Wednesday EOD if triggered early week, Friday if late)
    const now = new Date();
    const dayOfWeek = now.getDay();
    let deadline: Date;

    if (event.data?.deadline) {
      deadline = new Date(event.data.deadline);
    } else {
      // If Mon-Wed, deadline is Wednesday EOD
      // If Thu-Sun, deadline is next Friday EOD
      deadline = new Date(now);
      if (dayOfWeek <= 3) {
        // Mon=1, Tue=2, Wed=3
        deadline.setDate(now.getDate() + (3 - dayOfWeek)); // Wednesday
      } else {
        deadline.setDate(now.getDate() + ((5 - dayOfWeek + 7) % 7)); // Next Friday
      }
      deadline.setHours(17, 0, 0, 0); // 5 PM
    }

    const deadlineStr = deadline.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });

    // Mark scenario as active
    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    // Generate the investor email
    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: sarahInvestor.id,
        fromPersona: {
          name: sarahInvestor.name,
          role: sarahInvestor.role,
          communicationStyle: sarahInvestor.communicationStyle,
          signature: sarahInvestor.signature,
        },
        toEmail: alex.email,
        scenario: `Sarah is preparing for the quarterly board meeting next week and needs the updated 
metrics deck from Alex. The deadline is ${deadlineStr} EOD so board members have time to review.

Sarah needs:
1. Updated MRR and revenue metrics
2. Customer count and growth
3. Scribe utilization rates
4. NPS scores
5. Key wins and challenges from the quarter

The email should:
- Be professional but firm about the deadline
- Reference that this is standard board prep
- Mention that other board members will want time to review
- Offer to help if Alex needs anything
- Subtly convey that late materials reflect poorly

Sarah expects same-day acknowledgment and delivery by the deadline.`,
        additionalContext: `The board meeting is scheduled for the Friday following the deadline. 
There have been some concerns about growth metrics this quarter that Sarah will want to discuss.`,
      });
    });

    // Send the email as Sarah
    const sendResult = await step.run('send-initial-email', async () => {
      return gmail.sendEmailWithDryRun(sarahInvestor.email, {
        to: [alex.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    // Log the action
    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: sarahInvestor.id,
        tickId: 'scenario-seed',
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [alex.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: 'Scenario seed: Board deck request with deadline',
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      deadline: deadline.toISOString(),
      initialEmail: {
        to: alex.email,
        subject: emailContent.subject,
        messageId: sendResult.messageId,
        threadId: sendResult.threadId,
      },
      nextSteps: [
        'Alex-agent will see this as high priority (investor)',
        'Alex may delegate data gathering to Morgan/Jordan',
        'Chance-advisor may offer to review the deck',
        'Deadline pressure builds toward deadline date',
        'Sarah-agent may follow up if materials are late',
      ],
    };
  }
);

