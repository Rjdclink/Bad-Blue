// Email Service using Resend API
// Requires RESEND_API_KEY environment variable

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

// Initialize Resend client (lazily)
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable must be set');
    }
    resendClient = new Resend(process.env.RESEND_API_KEY);
    console.log('[RESEND] ✓ Client initialized');
  }
  return resendClient;
}

// Get the from address - use verified Resend domain or env variable
function getDefaultFromAddress(): string {
  // Priority: DEFAULT_FROM_EMAIL env var > Resend verified domain
  if (process.env.DEFAULT_FROM_EMAIL) {
    const fromName = process.env.DEFAULT_FROM_NAME || 'BadBlue';
    return `${fromName} <${process.env.DEFAULT_FROM_EMAIL}>`;
  }
  // Use Resend verified domain (update this to your verified domain)
  return 'BadBlue <onboarding@resend.dev>';
}

/**
 * Send email via Resend API
 * 
 * @param to - Recipient email address
 * @param subject - Email subject line
 * @param html - HTML body content (optional)
 * @param text - Plain text content (optional, recommended as fallback)
 * @param from - From address (defaults to Resend verified domain)
 * @param attachments - Optional email attachments
 * @returns Promise<boolean> - true if sent successfully, false otherwise
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
    const resend = getResendClient();
    const fromAddress = from || getDefaultFromAddress();

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
    
    if (error.message?.includes('API key')) {
      console.error('[RESEND] Invalid or missing API key - check RESEND_API_KEY');
    } else if (error.message?.includes('domain')) {
      console.error('[RESEND] Domain not verified - use a verified Resend domain');
    }
    
    return false;
  }
}

/**
 * Verify Resend API connection is working
 */
export async function verifySMTPConnection(): Promise<boolean> {
  try {
    const resend = getResendClient();
    // Test API by listing domains (lightweight API call)
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
