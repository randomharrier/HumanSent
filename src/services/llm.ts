/**
 * LLM service for agent decision-making
 *
 * Uses Anthropic Claude with structured JSON output.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AgentOutputSchema, type AgentOutput } from '../types/actions';
import type { AgentContext } from '../types/agent';
import { buildSystemPrompt, buildUserPrompt } from '../prompts';

// ============================================
// Types
// ============================================

interface LLMResponse {
  output: AgentOutput;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  rawResponse: string;
}

// ============================================
// Client Setup
// ============================================

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY environment variable');
    }

    anthropicClient = new Anthropic({ apiKey });
  }

  return anthropicClient;
}

// ============================================
// Main Agent Decision Function
// ============================================

/**
 * Get agent decision given context
 */
export async function getAgentDecision(context: AgentContext): Promise<LLMResponse> {
  const client = getClient();
  const model = 'claude-sonnet-4-20250514';

  const systemPrompt = buildSystemPrompt(context.agent);
  const userPrompt = buildUserPrompt(context);

  const startTime = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  const latencyMs = Date.now() - startTime;

  // Extract text content
  const textContent = response.content.find((c) => c.type === 'text');
  const rawResponse = textContent?.type === 'text' ? textContent.text : '';

  // Parse JSON from response
  const output = parseAgentOutput(rawResponse);

  return {
    output,
    model,
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
    latencyMs,
    rawResponse,
  };
}

// ============================================
// Response Parsing
// ============================================

/**
 * Parse and validate agent output from LLM response
 */
function parseAgentOutput(rawResponse: string): AgentOutput {
  // Try to extract JSON from the response
  let jsonStr = rawResponse;

  // Handle markdown code blocks
  const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object directly
  if (!jsonStr.startsWith('{')) {
    const objectMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as unknown;

    // Validate with Zod
    const result = AgentOutputSchema.safeParse(parsed);

    if (!result.success) {
      console.error('Agent output validation failed:', result.error.format());

      // Return a safe fallback
      return {
        reasoning: {
          observations: `Failed to parse agent output: ${result.error.message}`,
        },
        actions: [
          {
            type: 'no_action',
            reason: 'Failed to parse LLM response',
          },
        ],
      };
    }

    return result.data;
  } catch (error) {
    console.error('Failed to parse JSON from LLM response:', error);
    console.error('Raw response:', rawResponse.slice(0, 500));

    return {
      reasoning: {
        observations: 'Failed to parse JSON from LLM response',
      },
      actions: [
        {
          type: 'no_action',
          reason: 'Failed to parse LLM response as JSON',
        },
      ],
    };
  }
}

// ============================================
// Scenario Generation
// ============================================

/**
 * Generate a realistic email for a scenario seed
 */
export async function generateScenarioEmail(params: {
  fromAgent: string;
  fromPersona: {
    name: string;
    role: string;
    communicationStyle: string;
    signature: string;
  };
  toEmail: string;
  scenario: string;
  additionalContext?: string;
}): Promise<{ subject: string; body: string }> {
  const client = getClient();

  const systemPrompt = `You are generating a realistic email for a simulation.

The email is FROM: ${params.fromPersona.name} (${params.fromPersona.role})
Communication style: ${params.fromPersona.communicationStyle}
Signature: ${params.fromPersona.signature}

Write the email in character. Be authentic to the persona.
Respond with JSON: { "subject": "...", "body": "..." }`;

  const userPrompt = `Generate an email to ${params.toEmail} for this scenario:

${params.scenario}

${params.additionalContext ? `Additional context: ${params.additionalContext}` : ''}

The email should feel natural and authentic to the persona. Include appropriate emotional tone if relevant.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  const rawResponse = textContent?.type === 'text' ? textContent.text : '';

  // Parse JSON
  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse scenario email JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
  return parsed;
}

// ============================================
// Token Estimation
// ============================================

/**
 * Rough token count estimation (for budget planning)
 * Claude uses ~4 chars per token on average
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate cost for a context
 */
export function estimateCost(context: AgentContext): {
  estimatedPromptTokens: number;
  estimatedCost: number;
} {
  const systemPrompt = buildSystemPrompt(context.agent);
  const userPrompt = buildUserPrompt(context);

  const promptTokens = estimateTokens(systemPrompt + userPrompt);
  const completionTokens = 500; // Assume average completion

  // Claude Sonnet pricing (as of late 2024)
  const inputCostPer1M = 3.0;
  const outputCostPer1M = 15.0;

  const estimatedCost =
    (promptTokens / 1_000_000) * inputCostPer1M +
    (completionTokens / 1_000_000) * outputCostPer1M;

  return {
    estimatedPromptTokens: promptTokens,
    estimatedCost,
  };
}

