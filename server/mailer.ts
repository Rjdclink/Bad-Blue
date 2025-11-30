// Email Service using Resend API via Replit Integration
// Uses Replit's secure connector for API key management

import { Resend } from 'resend';

interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
}

// Connection settings cache (short-lived, refreshed each call)
let connectionSettings: any;

/**
 * Get Resend credentials - tries Replit connector first, then env variable
 */
async function getCredentials(): Promise<{ apiKey: string; fromEmail: string }> {
  // First try Replit connector
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (xReplitToken && hostname) {
    try {
      connectionSettings = await fetch(
        'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
        {
          headers: {
            'Accept': 'application/json',
            'X_REPLIT_TOKEN': xReplitToken
          }
        }
      ).then(res => res.json()).then(data => data.items?.[0]);

      // Only use connector if we got a valid API key (starts with re_)
      if (connectionSettings?.settings?.api_key?.startsWith('re_')) {
        console.log('[RESEND] Using Replit connector credentials');
        return {
          apiKey: connectionSettings.settings.api_key,
          fromEmail: connectionSettings.settings.from_email || 'onboarding@resend.dev'
        };
      }
    } catch (e) {
      console.log('[RESEND] Connector fetch failed, trying env variable');
    }
  }

  // Fallback to environment variable
  if (process.env.RESEND_API_KEY?.startsWith('re_')) {
    console.log('[RESEND] Using RESEND_API_KEY environment variable');
    return {
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.DEFAULT_FROM_EMAIL || 'onboarding@resend.dev'
    };
  }

  throw new Error('Resend not configured - please set a valid RESEND_API_KEY (must start with re_)');
}

/**
 * Get a fresh Resend client (never cache - tokens can expire)
 */
export async function getResendClient(): Promise<{ client: Resend; fromEmail: string }> {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail
  };
}

/**
 * Send email via Resend API
 */
export async function sendMail(
  to: string,
  subject: string,
  html: string | undefined,
  text?: string,
  from?: string,
  attachments?: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>
): Promise<boolean> {
  try {
    const { client: resend, fromEmail } = await getResendClient();
    const fromAddress = from || `BadBlue <${fromEmail}>`;

    const emailPayload: any = {
      from: fromAddress,
      to,
      subject,
    };

    if (html) emailPayload.html = html;
    if (text) emailPayload.text = text;

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      emailPayload.attachments = attachments.map(att => ({
        filename: att.filename,
        content: Buffer.from(att.content, 'base64'),
      }));
    }

    const { data, error } = await resend.emails.send(emailPayload);

    if (error) {
      console.error(`[RESEND] Failed to send email to ${to}:`, error);
      return false;
    }

    console.log(`[RESEND] ✓ Email sent to ${to} - ID: ${data?.id}`);
    return true;
  } catch (error: any) {
    console.error(`[RESEND] Failed to send email to ${to}:`, error.message);
    return false;
  }
}

/**
 * Verify Resend API connection is working
 */
export async function verifySMTPConnection(): Promise<boolean> {
  try {
    const { client: resend } = await getResendClient();
    const { data, error } = await resend.domains.list();
    
    if (error) {
      console.error('[RESEND] API verification failed:', error);
      return false;
    }
    
    console.log('[RESEND] ✓ API connection verified');
    console.log('[RESEND] ✓ Available domains:', data?.data?.length || 0);
    return true;
  } catch (error: any) {
    console.error('[RESEND] API verification failed:', error.message);
    return false;
  }
}

/**
 * Send email with full options object
 */
export async function sendMailWithOptions(options: EmailOptions): Promise<boolean> {
  return sendMail(
    options.to,
    options.subject,
    options.html,
    options.text,
    options.from,
    options.attachments
  );
}
