/**
 * Customer Win Scenario
 *
 * Big enterprise customer signed! Time to celebrate and plan.
 * Positive scenario with cross-functional impact.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { alex } from '../../agents/leadership/alex';
import { morgan } from '../../agents/leadership/morgan';
import { jordan } from '../../agents/leadership/jordan';
import { sam } from '../../agents/leadership/sam';
import { sarahInvestor } from '../../agents/external/sarah-investor';

export const customerWinScenario = inngest.createFunction(
  {
    id: 'scenario-customer-win',
    retries: 1,
  },
  { event: 'scenario/customer-win' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'customer-win';
    const customerName = event.data?.customerName || 'Meridian Partners';
    const contractValue = event.data?.contractValue || '$52,000';
    const useCase = event.data?.useCase || 'client appreciation cards';

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
        scenario: `Alex is announcing a big customer win to the leadership team!

${customerName} just signed a ${contractValue}/year contract for ${useCase}.

The email should:
- Share the exciting news with genuine enthusiasm
- Thank Jordan for the product work that made this possible
- Thank Morgan for ensuring ops can handle the volume
- Mention any special requirements or timeline
- Suggest a small celebration (team lunch, champagne, etc.)
- Note that Alex will share with Sarah (investor) separately

This is a WIN! The tone should be celebratory but also thoughtful about 
what it means for the team (more volume, proving enterprise viability).

Include a brief note about:
- Expected order volume per month
- Any customization requests
- Timeline for first batch`,
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
        reasoning: `Scenario seed: Customer win - ${customerName} (${contractValue})`,
      })
    );

    // Also send to investor
    await step.run('notify-investor', async () => {
      const investorEmail = await llm.generateScenarioEmail({
        fromAgent: alex.id,
        fromPersona: {
          name: alex.name,
          role: alex.role,
          communicationStyle: alex.communicationStyle,
          signature: alex.signature,
        },
        toEmail: sarahInvestor.email,
        scenario: `Alex is updating Sarah (investor) about the ${customerName} win.

Keep it brief and professional:
- Share the win (${contractValue}/year)
- Note this validates enterprise potential
- Mention it's the largest contract to date (if applicable)
- Brief note on pipeline if relevant

Investors love updates like this!`,
      });

      return gmail.sendEmailWithDryRun(alex.email, {
        to: [sarahInvestor.email],
        subject: investorEmail.subject,
        body: investorEmail.body,
      });
    });

    return {
      status: 'seeded',
      scenarioId,
      customerName,
      contractValue,
      description: `Customer win: ${customerName} signed ${contractValue}/year`,
      expectedBehavior: [
        'Team celebrates and congratulates',
        'Morgan starts capacity planning',
        'Jordan notes product feedback',
        'Sarah responds positively',
        'Discussion about onboarding the customer',
      ],
    };
  }
);

