/**
 * Interview Scheduling Scenario
 *
 * Strong candidate needs interviews scheduled.
 * Cross-functional hiring coordination.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { alex } from '../../agents/leadership/alex';
import { jordan } from '../../agents/leadership/jordan';
import { sam } from '../../agents/leadership/sam';
import { taylor } from '../../agents/internal/taylor';

export const interviewSchedulingScenario = inngest.createFunction(
  {
    id: 'scenario-interview-scheduling',
    retries: 1,
  },
  { event: 'scenario/interview-scheduling' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'interview-scheduling';
    const role = event.data?.role || 'Product Designer';
    const candidateName = event.data?.candidateName || 'Jamie Rodriguez';

    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: jordan.id,
        fromPersona: {
          name: jordan.name,
          role: jordan.role,
          communicationStyle: jordan.communicationStyle,
          signature: jordan.signature,
        },
        toEmail: alex.email,
        scenario: `Jordan has found a strong candidate (${candidateName}) for the ${role} role 
and needs to coordinate interviews.

The email should:
- Express excitement about the candidate (they're strong!)
- Briefly describe why they're a good fit
- Request time from Alex for a culture/leadership interview
- Mention who else should interview (Sam for technical fit, Taylor for team dynamics)
- Suggest a timeline (ideally this week or early next week)
- Ask for availability and offer to coordinate

The candidate is currently interviewing at other companies, so there's some 
time sensitivity but nothing panic-inducing.

Keep it professional and enthusiastic - this is a positive hiring moment!`,
      });
    });

    const sendResult = await step.run('send-email', async () => {
      return gmail.sendEmailWithDryRun(jordan.email, {
        to: [alex.email],
        cc: [sam.email, taylor.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: jordan.id,
        tickId: undefined,
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [alex.email],
          cc: [sam.email, taylor.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: `Scenario seed: Interview scheduling for ${role} candidate`,
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      candidate: candidateName,
      role,
      description: `Interview scheduling for ${role} candidate ${candidateName}`,
      expectedBehavior: [
        'Alex responds with availability',
        'Sam confirms interest in technical interview',
        'Taylor offers to coordinate logistics',
        'Discussion about interview structure',
        'Tasks created to prepare interview questions',
      ],
    };
  }
);

