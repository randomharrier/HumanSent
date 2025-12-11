/**
 * HumanSent product laws and cultural beliefs
 *
 * These are non-negotiable constraints that agents must respect.
 * They create the natural friction that generates realistic customer tension.
 */

/**
 * Product Laws - NEVER violate these
 */
export const PRODUCT_LAWS = [
  'No instant delivery. Every message must be physically mailed (4-7 day delivery).',
  'All handwriting is real. No fonts, no robots, no plotters. Every card is written by a human scribe.',
  'Photos must be taken live in-app, with zero preview. Cannot come from camera roll.',
  'Messages cannot be edited once sent. No undo, no recall.',
  'No digital copies stored after writing. If it exists, it exists as a physical card only.',
] as const;

/**
 * Cultural Beliefs - The "why" behind the constraints
 */
export const CULTURAL_BELIEFS = [
  'Urgency is usually a lie.',
  'Regret is part of authenticity.',
  'Friction makes words matter.',
] as const;

/**
 * Company context for prompts
 */
export const COMPANY_CONTEXT = {
  name: 'HumanSent',
  stage: 'Seed-stage startup',
  funding: '$2.3M raised',
  product:
    'Converts modern digital communication into delayed, hand-written postcards created by real humans',
  tagline:
    'Every "text" becomes a physical postcard, written by a live human whose handwriting is algorithmically matched to the sender.',

  // Common customer pain points (for realistic scenarios)
  customerPainPoints: [
    'Delivery complaints — customers expect instant, get 4-7 days',
    'Photo authenticity debates — no camera roll, no preview, no do-overs',
    'Handwriting matching issues — scribe availability, style consistency',
    'No undo/recall requests — messages cannot be edited once sent',
    'Legal grey areas — "no digital copies stored" creates compliance questions',
  ],

  // How the team thinks about these constraints
  teamMindset:
    'The team is earnest and passionate about these constraints, not ironic. They believe these "limitations" are actually the product\'s core value proposition.',
} as const;

/**
 * Business parameters
 */
export const BUSINESS_PARAMS = {
  deliveryTimeDays: { min: 4, max: 7, typical: 5 },
  scribeCapacityCardsPerDay: 50, // Per scribe
  averageOrderValue: 15,
  enterpriseContractMinimum: 25000, // Annual
  scribesActive: 25, // Current scribe network size
} as const;

/**
 * Agent email domain
 */
export const EMAIL_DOMAIN = 'humansent.co';

/**
 * Slack workspace
 */
export const SLACK_WORKSPACE = 'humansent.slack.com';

/**
 * Slack channels
 */
export const SLACK_CHANNELS = {
  leadership: 'leadership',
  engineering: 'engineering',
  operations: 'operations',
  product: 'product',
  customerEscalations: 'customer-escalations',
  allHumansent: 'all-humansent',
  random: 'random',
} as const;

