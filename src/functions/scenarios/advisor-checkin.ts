/**
 * Advisor Check-in Scenario
 *
 * Chance (you) reaches out for monthly advisory check-in.
 * Strategic conversation starter.
 */

import { inngest } from '../../inngest-client';
import { gmail, llm, db } from '../../services';
import { alex } from '../../agents/leadership/alex';
import { chanceAdvisor } from '../../agents/external/chance-advisor';

export const advisorCheckinScenario = inngest.createFunction(
  {
    id: 'scenario-advisor-checkin',
    retries: 1,
  },
  { event: 'scenario/advisor-checkin' },
  async ({ event, step }) => {
    const scenarioId = event.data?.scenarioId || 'advisor-checkin';
    const topic = event.data?.topic || 'general';

    await step.run('activate-scenario', () =>
      db.updateScenarioStatus(scenarioId, 'active')
    );

    let scenarioContext = '';
    switch (topic) {
      case 'fundraising':
        scenarioContext = `Focus on fundraising - ask about runway, Series A timeline, 
investor conversations. Offer to make introductions if helpful.`;
        break;
      case 'hiring':
        scenarioContext = `Focus on team building - ask about key hires needed, 
culture as team grows, org structure thoughts.`;
        break;
      case 'strategy':
        scenarioContext = `Focus on strategy - ask about competitive landscape, 
product direction, biggest opportunities and threats.`;
        break;
      case 'personal':
        scenarioContext = `Focus on Alex personally - how are they doing, avoiding burnout, 
work-life balance. Be a supportive mentor.`;
        break;
      default:
        scenarioContext = `General check-in - how's everything going, what's on your mind, 
anything I can help with?`;
    }

    const emailContent = await step.run('generate-email', async () => {
      return llm.generateScenarioEmail({
        fromAgent: chanceAdvisor.id,
        fromPersona: {
          name: chanceAdvisor.name,
          role: chanceAdvisor.role,
          communicationStyle: chanceAdvisor.communicationStyle,
          signature: chanceAdvisor.signature,
        },
        toEmail: alex.email,
        scenario: `Chance is reaching out for a regular advisory check-in with Alex.

${scenarioContext}

The email should:
- Be warm and genuine
- Ask how things are going
- Offer 1-2 specific topics to discuss
- Mention availability for a call
- Be supportive, not pushy

Chance genuinely cares about Alex's success and wants to be helpful.
Keep it brief - advisors are busy too.`,
      });
    });

    const sendResult = await step.run('send-email', async () => {
      return gmail.sendEmailWithDryRun(chanceAdvisor.email, {
        to: [alex.email],
        subject: emailContent.subject,
        body: emailContent.body,
      });
    });

    await step.run('log-scenario-seed', () =>
      db.logAgentAction({
        agentId: chanceAdvisor.id,
        tickId: 'scenario-seed',
        actionType: 'send_email',
        payload: {
          type: 'send_email',
          to: [alex.email],
          subject: emailContent.subject,
          body: emailContent.body,
          ...sendResult,
        },
        reasoning: `Scenario seed: Advisor check-in (${topic})`,
      })
    );

    return {
      status: 'seeded',
      scenarioId,
      topic,
      description: `Advisor check-in from Chance (${topic})`,
      expectedBehavior: [
        'Alex responds warmly and shares updates',
        'May schedule a call',
        'Opens up about challenges or opportunities',
        'Creates strategic conversation thread',
      ],
    };
  }
);

