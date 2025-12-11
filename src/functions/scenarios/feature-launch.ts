/**
 * Feature Launch Scenario
 *
 * New feature is ready to launch, coordination needed.
 * Cross-functional product launch scenario.
 */

import { inngest } from '../../index';
import { gmail, llm, db } from '../../services';
import { jordan } from '../../agents/leadership/jordan';
import { sam } from '../../agents/leadership/sam';
import { alex } from '../../agents/leadership/alex';
import { taylor } from '../../agents/internal/taylor';
import { riley } from '../../agents/internal/riley';

export const featureLaunchScenario = inngest.createFunction(
  {
    id: 'scenario-feature-launch',
    retries: 1,
  },
  { event: 'scenario/feature-launch' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'feature-launch';
    const featureName = event.data?.featureName || 'Handwriting Style Preview';

    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    // Launch date (3 days from now)
    const launchDate = new Date();
    launchDate.setDate(launchDate.getDate() + 3);
    const launchDateStr = launchDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: jordan.id,
        fromPersona: {
          name: jordan.name,
          role: jordan.role,
          communicationStyle: jordan.communicationStyle,
          signature: jordan.signature,
        },
        toEmail: sam.email,
        scenario: `Jordan is coordinating the launch of "${featureName}" scheduled for ${launchDateStr}.

The email should:
- Confirm the feature is ready for launch (engineering signed off)
- Outline the launch checklist:
  - Final QA pass needed
  - Customer communication prep (Taylor)
  - App store description update if needed
  - Monitoring plan for launch day
  - Rollback plan if issues
- Ask Sam/Riley to confirm engineering readiness
- Mention Alex should be looped in for any customer comms
- Set up a quick sync call day before launch

Tone: Excited but organized. This is a positive milestone!

The feature: ${featureName} - lets customers preview different handwriting 
styles before selecting a scribe (while maintaining the "no camera roll" photo rule).`,
      });
    });

    const sendResult = await step.run('send-email', async () => {
      return gmail.sendEmailWithDryRun(jordan.email, {
        to: [sam.email],
        cc: [alex.email, taylor.email, riley.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: jordan.id,
        tickId: 'scenario-seed',
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [sam.email],
          cc: [alex.email, taylor.email, riley.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: `Scenario seed: ${featureName} launch coordination`,
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      featureName,
      launchDate: launchDate.toISOString(),
      description: `Feature launch coordination for "${featureName}"`,
      expectedBehavior: [
        'Sam/Riley confirm engineering readiness',
        'Taylor prepares customer communication',
        'Alex acknowledges and offers support',
        'Tasks created for launch checklist items',
        'Discussion about monitoring and rollback',
      ],
    };
  }
);

