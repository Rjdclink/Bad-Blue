// Email Service using Resend API
// Platform-agnostic - uses RESEND_API_KEY environment variable

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

/**
 * Get Resend credentials from environment variable
 */
async function getCredentials(): Promise<{ apiKey: string; fromEmail: string }> {
  // Use RESEND_API_KEY environment variable
  if (process.env.RESEND_API_KEY?.startsWith('re_')) {
    return {
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: process.env.DEFAULT_FROM_EMAIL || 'onboarding@resend.dev'
    };
  }

  throw new Error('Resend not configured - please set RESEND_API_KEY in secrets (must start with re_)');
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
