/**
 * Gmail service for reading and sending emails
 *
 * Uses Google Workspace with domain-wide delegation to act on behalf of agents.
 */

import { google, gmail_v1 } from 'googleapis';
import type { EmailMessage } from '../types';

// ============================================
// Types
// ============================================

interface GmailCredentials {
  serviceAccountEmail: string;
  privateKey: string;
}

interface SendEmailOptions {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  threadId?: string;
}

// ============================================
// Client Setup
// ============================================

function getCredentials(): GmailCredentials {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!serviceAccountEmail || !privateKey) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY environment variables'
    );
  }

  return { serviceAccountEmail, privateKey };
}

function getGmailClient(userEmail: string): gmail_v1.Gmail {
  const { serviceAccountEmail, privateKey } = getCredentials();

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
    subject: userEmail, // Impersonate this user
  });

  return google.gmail({ version: 'v1', auth });
}

// ============================================
// Read Operations
// ============================================

/**
 * Get recent emails for an agent (unread + recent read)
 */
export async function getRecentEmails(
  agentEmail: string,
  options?: {
    maxResults?: number;
    includeRead?: boolean;
    hoursBack?: number;
  }
): Promise<EmailMessage[]> {
  const gmail = getGmailClient(agentEmail);
  const maxResults = options?.maxResults ?? 20;
  const hoursBack = options?.hoursBack ?? 48;

  // Build query
  const queries: string[] = [];

  if (!options?.includeRead) {
    queries.push('is:unread');
  } else {
    // Get emails from last N hours
    const afterDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    queries.push(`after:${Math.floor(afterDate.getTime() / 1000)}`);
  }

  // Exclude sent mail (we want incoming)
  queries.push('in:inbox');

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: queries.join(' '),
  });

  const messages = response.data.messages || [];

  // Fetch full message details
  const emails: EmailMessage[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;

    try {
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const email = parseGmailMessage(fullMessage.data);
      if (email) {
        emails.push(email);
      }
    } catch (error) {
      console.error(`Failed to fetch message ${msg.id}:`, error);
    }
  }

  return emails;
}

/**
 * Get emails from a specific thread
 */
export async function getThreadEmails(
  agentEmail: string,
  threadId: string
): Promise<EmailMessage[]> {
  const gmail = getGmailClient(agentEmail);

  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = response.data.messages || [];

  return messages
    .map((msg) => parseGmailMessage(msg))
    .filter((e): e is EmailMessage => e !== null);
}

/**
 * Mark emails as read
 */
export async function markAsRead(agentEmail: string, messageIds: string[]): Promise<void> {
  const gmail = getGmailClient(agentEmail);

  await gmail.users.messages.batchModify({
    userId: 'me',
    requestBody: {
      ids: messageIds,
      removeLabelIds: ['UNREAD'],
    },
  });
}

// ============================================
// Write Operations
// ============================================

/**
 * Send an email as an agent
 */
export async function sendEmail(
  agentEmail: string,
  options: SendEmailOptions
): Promise<{ messageId: string; threadId: string }> {
  const gmail = getGmailClient(agentEmail);

  // Build the email
  const emailLines: string[] = [
    `From: ${agentEmail}`,
    `To: ${options.to.join(', ')}`,
  ];

  if (options.cc && options.cc.length > 0) {
    emailLines.push(`Cc: ${options.cc.join(', ')}`);
  }

  emailLines.push(`Subject: ${options.subject}`);

  if (options.inReplyTo) {
    emailLines.push(`In-Reply-To: ${options.inReplyTo}`);
    emailLines.push(`References: ${options.inReplyTo}`);
  }

  emailLines.push('Content-Type: text/plain; charset=utf-8');
  emailLines.push('');
  emailLines.push(options.body);

  const rawEmail = emailLines.join('\r\n');
  const encodedEmail = Buffer.from(rawEmail).toString('base64url');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedEmail,
      threadId: options.threadId,
    },
  });

  return {
    messageId: response.data.id || '',
    threadId: response.data.threadId || '',
  };
}

/**
 * Reply to an existing email thread
 */
export async function replyToEmail(
  agentEmail: string,
  originalEmail: EmailMessage,
  body: string
): Promise<{ messageId: string; threadId: string }> {
  // Determine subject (add Re: if not already present)
  let subject = originalEmail.subject;
  if (!subject.toLowerCase().startsWith('re:')) {
    subject = `Re: ${subject}`;
  }

  // Reply to the sender (swap to/from)
  const to = [originalEmail.from];

  return sendEmail(agentEmail, {
    to,
    subject,
    body,
    inReplyTo: originalEmail.id,
    threadId: originalEmail.threadId,
  });
}

// ============================================
// Sync Operations
// ============================================

/**
 * Get the current history ID for incremental sync
 */
export async function getHistoryId(agentEmail: string): Promise<string> {
  const gmail = getGmailClient(agentEmail);

  const response = await gmail.users.getProfile({
    userId: 'me',
  });

  return response.data.historyId || '';
}

/**
 * Get changes since a history ID (for incremental sync)
 */
export async function getHistorySince(
  agentEmail: string,
  startHistoryId: string
): Promise<{
  newHistoryId: string;
  addedMessageIds: string[];
}> {
  const gmail = getGmailClient(agentEmail);

  const addedMessageIds: string[] = [];
  let pageToken: string | undefined;
  let newHistoryId = startHistoryId;

  do {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      pageToken,
    });

    newHistoryId = response.data.historyId || newHistoryId;

    for (const history of response.data.history || []) {
      for (const added of history.messagesAdded || []) {
        if (added.message?.id) {
          addedMessageIds.push(added.message.id);
        }
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return { newHistoryId, addedMessageIds };
}

// ============================================
// Helpers
// ============================================

function parseGmailMessage(message: gmail_v1.Schema$Message): EmailMessage | null {
  if (!message.id || !message.threadId) return null;

  const headers = message.payload?.headers || [];
  const getHeader = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

  // Parse From header
  const fromRaw = getHeader('From');
  const fromMatch = fromRaw.match(/<(.+?)>/) || [null, fromRaw];
  const from = fromMatch[1] || fromRaw;
  const fromNameMatch = fromRaw.match(/^(.+?)\s*</);
  const fromName = fromNameMatch?.[1]?.replace(/"/g, '') || undefined;

  // Parse To header
  const toRaw = getHeader('To');
  const to = toRaw
    .split(',')
    .map((t) => {
      const match = t.match(/<(.+?)>/);
      return match ? match[1] : t.trim();
    })
    .filter(Boolean);

  // Parse CC header
  const ccRaw = getHeader('Cc');
  const cc = ccRaw
    ? ccRaw
        .split(',')
        .map((t) => {
          const match = t.match(/<(.+?)>/);
          return match ? match[1] : t.trim();
        })
        .filter(Boolean)
    : undefined;

  // Get body
  const body = extractBody(message.payload);

  // Get labels
  const labels = message.labelIds || [];
  const isRead = !labels.includes('UNREAD');

  // Parse date
  const dateHeader = getHeader('Date');
  const timestamp = dateHeader ? new Date(dateHeader) : new Date(parseInt(message.internalDate || '0'));

  return {
    id: message.id,
    threadId: message.threadId,
    from,
    fromName,
    to,
    cc,
    subject: getHeader('Subject'),
    bodyPreview: body.slice(0, 500),
    fullBody: body,
    timestamp,
    isRead,
    labels,
  };
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Try to get plain text body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // Check parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }

      // Recurse into multipart
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }

    // Fallback to HTML if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        // Basic HTML to text conversion
        return html
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
      }
    }
  }

  return '';
}

// ============================================
// Dry Run Mode
// ============================================

/**
 * Check if dry run mode is enabled
 */
export function isDryRunMode(): boolean {
  return process.env.DRY_RUN_MODE === 'true';
}

/**
 * Send email with dry run support
 */
export async function sendEmailWithDryRun(
  agentEmail: string,
  options: SendEmailOptions
): Promise<{ messageId: string; threadId: string; dryRun: boolean }> {
  if (isDryRunMode()) {
    console.warn('[DRY RUN] Would send email:', {
      from: agentEmail,
      to: options.to,
      subject: options.subject,
      bodyPreview: options.body.slice(0, 100),
    });
    return {
      messageId: `dry-run-${Date.now()}`,
      threadId: options.threadId || `dry-run-thread-${Date.now()}`,
      dryRun: true,
    };
  }

  const result = await sendEmail(agentEmail, options);
  return { ...result, dryRun: false };
}

