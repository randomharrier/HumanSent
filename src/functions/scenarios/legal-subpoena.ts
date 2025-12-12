/**
 * Legal Subpoena Scenario
 *
 * Simulates a compliance pressure situation where legal counsel
 * receives a subpoena for customer message content.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { robertLegal } from '../../agents/external/robert-legal';
import { alex } from '../../agents/leadership/alex';
import { morgan } from '../../agents/leadership/morgan';

export const legalSubpoenaScenario = inngest.createFunction(
  {
    id: 'scenario-legal-subpoena',
    retries: 1,
  },
  { event: 'scenario/legal-subpoena' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'legal-subpoena';

    // Mark scenario as active
    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    // Generate the legal inquiry email
    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: robertLegal.id,
        fromPersona: {
          name: robertLegal.name,
          role: robertLegal.role,
          communicationStyle: robertLegal.communicationStyle,
          signature: robertLegal.signature,
        },
        toEmail: alex.email,
        scenario: `Robert has received a subpoena from attorneys in a civil litigation case. 
The subpoena requests all message content sent by a specific HumanSent customer over the past 6 months. 

This creates a significant compliance challenge because HumanSent's core product philosophy is 
"no digital copies stored after writing" - the message exists only as a physical card.

Robert needs to:
- Alert Alex (and CC Morgan) to the situation urgently
- Ask clarifying questions about what data HumanSent actually retains
- Understand the technical reality vs. the marketing message
- Discuss how to respond to the subpoena
- Flag potential liability if the "no digital copies" claim isn't accurate

The email should be formal, thorough, and convey urgency without being alarmist.
Request a call to discuss.`,
        additionalContext: `The customer in question is involved in a contentious divorce case. 
Their spouse's attorneys believe messages sent via HumanSent may contain relevant evidence.`,
      });
    });

    // Send the email as Robert
    const sendResult = await step.run('send-initial-email', async () => {
      return gmail.sendEmailWithDryRun(robertLegal.email, {
        to: [alex.email],
        cc: [morgan.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    // Log the action
    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: robertLegal.id,
        tickId: undefined,
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [alex.email],
          cc: [morgan.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: 'Scenario seed: Legal subpoena inquiry',
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      initialEmail: {
        to: alex.email,
        cc: [morgan.email],
        subject: emailContent.subject,
        messageId: sendResult.messageId,
        threadId: sendResult.threadId,
      },
      nextSteps: [
        'Alex-agent will see this as high priority (legal)',
        'May involve Sarah (investor) due to liability concerns',
        'Cross-functional discussion about "no digital copy" policy',
        'Resolution depends on what data HumanSent actually retains',
      ],
    };
  }
);

