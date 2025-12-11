/**
 * Expense Reports Scenario
 *
 * Finance sends reminder that expense reports are due.
 * Creates routine cross-team communication.
 */

import { inngest } from '../../index';
import { gmail, db } from '../../services';
import { alex } from '../../agents/leadership/alex';
import { morgan } from '../../agents/leadership/morgan';
import { jordan } from '../../agents/leadership/jordan';
import { sam } from '../../agents/leadership/sam';
import { taylor } from '../../agents/internal/taylor';
import { riley } from '../../agents/internal/riley';
import { casey } from '../../agents/internal/casey';

export const expenseReportsScenario = inngest.createFunction(
  {
    id: 'scenario-expense-reports',
    retries: 1,
  },
  { event: 'scenario/expense-reports' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'expense-reports';

    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    // Calculate due date (next Friday)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + ((5 - dueDate.getDay() + 7) % 7 || 7));
    const dueDateStr = dueDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const emailBody = `Hi team,

Friendly reminder that expense reports for this month are due by end of day ${dueDateStr}.

Please submit any outstanding expenses through Expensify. If you have questions about what's reimbursable or need help with the system, just reply to this email.

Outstanding items I'm tracking:
- Conference travel (if applicable)
- Team meals/events
- Software subscriptions
- Office supplies

Let me know if you need an extension, but please flag it before the deadline.

Thanks!
Finance`;

    const sendResult = await step.run('send-email', async () => {
      return gmail.sendEmailWithDryRun('finance@humansent.co', {
        to: [
          alex.email,
          morgan.email,
          jordan.email,
          sam.email,
          taylor.email,
          riley.email,
          casey.email,
        ],
        subject: `📋 Expense Reports Due ${dueDateStr}`,
        body: emailBody,
      });
    });

    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: 'finance',
        tickId: 'scenario-seed',
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: 'all-team',
          subject: `Expense Reports Due ${dueDateStr}`,
          ...sendResult,
        },
        reasoning: 'Scenario seed: Monthly expense report reminder',
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      dueDate: dueDate.toISOString(),
      description: 'Expense report reminder sent to all team',
      expectedBehavior: [
        'Some agents may create tasks to submit expenses',
        'Morgan might follow up with ops team',
        'Casual acknowledgments or questions',
        'Potential for someone to ask for extension',
      ],
    };
  }
);

