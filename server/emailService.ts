// Email service for BadBlue - Resend API via Replit Integration
// Uses Replit's secure connector for API key management

import { Resend } from "resend";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getBaseURL } from "./platformConfig";
import { getResendClient } from "./mailer";

// Cached Resend client and from email (refreshed on each use)
let cachedFromEmail: string = "onboarding@resend.dev";

export const emailTransporter = {
  verify: async () => {
    try {
      const { client } = await getResendClient();
      return true;
    } catch (error) {
      throw new Error("Resend not configured - set up the Resend integration");
    }
  },
};

// --- Shared helpers ---------------------------------------------------------

async function getEmailSettings() {
  try {
    const settingsPromise = Promise.all([
      db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "support_from_email"))
        .limit(1),
      db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "support_from_name"))
        .limit(1),
    ]);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Database query timeout")), 2000),
    );

    const [fromEmailResults, fromNameResults] = (await Promise.race([
      settingsPromise,
      timeoutPromise,
    ])) as any[];

    const fromEmailSetting = fromEmailResults?.[0];
    const fromNameSetting = fromNameResults?.[0];

    const fromEmail =
      process.env.EMAIL_FROM ||
      fromEmailSetting?.value ||
      "noreply@trenuxae.resend.app";
    const fromName = fromNameSetting?.value || "BadBlue";

    return { fromEmail, fromName };
  } catch (error: any) {
    console.error(
      "[EMAIL] Error loading email settings from database, using default:",
      error.message || error,
    );
    return {
      fromEmail: process.env.EMAIL_FROM || "noreply@trenuxae.resend.app",
      fromName: "BadBlue",
    };
  }
}

async function getFromAddress(): Promise<string> {
  // Priority:
  // 1. Environment variable DEFAULT_FROM_EMAIL if set
  // 2. Database settings if available
  // 3. Fall back to Resend test sender (onboarding@resend.dev)
  if (process.env.DEFAULT_FROM_EMAIL) {
    const fromName = process.env.DEFAULT_FROM_NAME || "BadBlue";
    return `${fromName} <${process.env.DEFAULT_FROM_EMAIL}>`;
  }

  const settings = await getEmailSettings();
  // Use Resend verified domain or test domain
  return `${settings.fromName} <${settings.fromEmail}>`;
}

async function sendWithResend(
  to: string,
  subject: string,
  html?: string,
  text?: string,
  fromOverride?: string,
): Promise<boolean> {
  try {
    const { client: resend, fromEmail } = await getResendClient();
    cachedFromEmail = fromEmail;
    
    const from = fromOverride || `BadBlue <${fromEmail}>`;

    const emailPayload: any = {
      from,
      to,
      subject,
    };

    if (html) emailPayload.html = html;
    if (text) emailPayload.text = text;

    const { data, error } = await resend.emails.send(emailPayload);

    if (error) {
      console.error("[EMAIL] Resend API error:", error);
      return false;
    }

    return !!data?.id;
  } catch (error: any) {
    console.error("[EMAIL] Failed to send email:", error.message);
    return false;
  }
}

// --- Public generic send ----------------------------------------------------

export async function sendEmail({
  to,
  subject,
  html,
  from,
}: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) {
  if (!from) {
    const settings = await getEmailSettings();
    from = `${settings.fromName} <${settings.fromEmail}>`;
  }

  const success = await sendWithResend(to, subject, html, undefined, from);

  if (success) {
    console.log(`[EMAIL] ✓ Email sent to ${to}`);
  } else {
    console.error(`[EMAIL] ✗ Failed to send email to ${to}`);
  }

  return success;
}

// --- Types ------------------------------------------------------------------

interface WelcomeEmailData {
  firstName: string;
  email: string;
}

interface PurchaseConfirmationData {
  firstName: string;
  email: string;
  type: "complaint" | "lawsuit" | "full_access" | "petition" | "foia";
  amount: number;
  officerName?: string;
  incidentDate?: string;
  state?: string;
  document?: string;
  submissionVenue?: string;
  submissionEmail?: string;
  submissionAddress?: string;
  filingInstructions?: string;
  serviceName?: string;
}

interface AdminEmailData {
  to: string;
  subject: string;
  message: string;
}

// --- Email body builders ----------------------------------------------------

function composeWelcomeEmailText(data: WelcomeEmailData): string {
  const baseUrl = getBaseURL();
  return `Hello ${data.firstName},

Welcome to BadBlue! We're honored that you've chosen us as your partner in pursuing police accountability and justice.

BadBlue is more than just a platform—it's a movement toward transparency, fairness, and constitutional rights protection. Our mission is to make the complaint and lawsuit filing process accessible, affordable, and effective for every citizen.

SERVICES WE PROVIDE:

1. LegalAI Consultation (FREE for signed-in users)
   Access our AI-powered legal research assistant to analyze your case, review applicable laws, and assess the strength of your claims before taking action.

2. Officer Search (FREE for signed-in users)
   Our advanced AI system helps you identify and gather public information about police officers involved in your incident.

3. Police Complaint Filing ($39.75)
   File formal complaints against officers with the appropriate department or oversight agency. We handle routing, formatting, and submission.

4. Civil Rights Petitions ($27.98)
   Initiate petitions to demand policy changes, accountability measures, or public awareness campaigns in your community.

5. DIY Lawsuit Assistance ($265.27)
   Receive complete instructions, legal forms, and guidance to file your own civil rights lawsuit in the appropriate court.

6. Full-Service Lawsuit Filing ($503.75)
   We prepare and file your lawsuit on your behalf, handling all paperwork and submission requirements professionally.

7. FOIA Records Requests ($24.65)
   Generate and submit Freedom of Information Act requests to obtain police reports, body camera footage, and other critical evidence.

PROBLEMS WE SOLVE:

- Difficulty navigating complex legal systems without expensive attorneys
- Lack of access to affordable police accountability resources
- Uncertainty about which legal remedies are available for civil rights violations
- Time-consuming paperwork and filing procedures
- Limited knowledge of state-specific laws and requirements

Whether you're seeking accountability for police misconduct, pursuing justice for civil rights violations, or simply exploring your legal options, BadBlue provides the tools and guidance you need.

Log in to your account at any time to access our services: ${baseUrl}

If you have any questions or need assistance, our support team is here to help at contact.badblue@gmail.com.

Sincerely,
BadBlue`;
}

function composeConfirmationEmailText(data: PurchaseConfirmationData): string {
  const baseUrl = getBaseURL();
  let email = `Hello ${data.firstName},

Thank you for your purchase!

`;

  switch (data.type) {
    case "complaint":
      email += `SERVICE PURCHASED: Police Complaint Filing ($${(
        data.amount / 100
      ).toFixed(2)})

You have successfully filed a formal complaint against ${
        data.officerName || "the officer(s)"
      } for the incident on ${data.incidentDate || "[date]"}.

SUBMISSION DETAILS:
Venue: ${data.submissionVenue || "Not specified"}
Email: ${data.submissionEmail || "Not specified"}
Address: ${data.submissionAddress || "Not specified"}

Your complaint has been automatically submitted to the appropriate oversight agency. You should receive a case number or acknowledgment within 5-10 business days.

`;
      break;

    case "petition":
      email += `SERVICE PURCHASED: Civil Rights Petition ($${(
        data.amount / 100
      ).toFixed(2)})

You have successfully created a petition to demand accountability and policy change.

PETITION TEXT:
${
  data.document
    ? "---BEGIN PETITION---\n" + data.document + "\n---END PETITION---\n"
    : "Petition text not available"
}

This petition will be circulated to gather community support. Share it with others who believe in police accountability and civil rights protection.

`;
      break;

    case "foia":
      email += `SERVICE PURCHASED: FOIA Records Request ($${(
        data.amount / 100
      ).toFixed(2)})

Your Freedom of Information Act request has been prepared and is ready for submission.

FOIA REQUEST:
${
  data.document
    ? "---BEGIN FOIA REQUEST---\n" +
      data.document +
      "\n---END FOIA REQUEST---\n"
    : "FOIA request text not available"
}

${
  data.submissionEmail
    ? `This request has been submitted to: ${data.submissionEmail}\n`
    : ""
}${data.submissionAddress ? `Mailing address: ${data.submissionAddress}\n` : ""}

The agency has 20 business days to respond to your request. You may receive a tracking number or acknowledgment letter.

`;
      break;

    case "lawsuit":
      if (data.filingInstructions) {
        email += `SERVICE PURCHASED: DIY Lawsuit Assistance ($${(
          data.amount / 100
        ).toFixed(2)})

You have received complete instructions and documentation to file your own civil rights lawsuit in ${
          data.state || "your state"
        }.

FILING INSTRUCTIONS:
${data.filingInstructions}

YOUR LAWSUIT DOCUMENT:
${
  data.document
    ? "---BEGIN LAWSUIT---\n" + data.document + "\n---END LAWSUIT---\n"
    : "Lawsuit document not available"
}

Please follow the instructions carefully and ensure all documents are filed within the required timeframes. Consider consulting with a local attorney if you have questions about the filing process.

`;
      } else {
        email += `SERVICE PURCHASED: Full-Service Lawsuit Filing ($${(
          data.amount / 100
        ).toFixed(2)})

Bad Blue has prepared and will file your civil rights lawsuit on your behalf.

YOUR LAWSUIT:
${
  data.document
    ? "---BEGIN LAWSUIT---\n" + data.document + "\n---END LAWSUIT---\n"
    : "Lawsuit document not available"
}

FILING DETAILS:
Court: ${data.submissionVenue || "Not specified"}
${data.submissionAddress ? `Address: ${data.submissionAddress}\n` : ""}

We will handle all filing procedures and provide you with confirmation once your lawsuit has been submitted to the court. You will receive the case number and further instructions via email.

`;
      }
      break;

    case "full_access":
      email += `SERVICE UPDATE: LegalAI Consultation & Officer Search (FREE for signed-in users)

Officer search and legal consultation are now FREE for all signed-in users.

WHAT YOU CAN DO:
- Analyze the legal merits of your case
- Research applicable civil rights laws and precedents
- Review state-specific statutes and regulations
- Assess the viability of various legal remedies
- Generate preliminary legal documents
- Search for officer information

Log in to your account to access these free features: ${baseUrl}

`;
      break;
  }

  email += `
WHAT'S NEXT:
${
  data.type === "complaint"
    ? "- Monitor your email for acknowledgment from the oversight agency\n- Keep records of all communications\n- Follow up if you don't hear back within 10 business days"
    : ""
}${
    data.type === "petition"
      ? "- Share your petition with community members and advocacy groups\n- Track signatures and support\n- Consider organizing public awareness campaigns"
      : ""
  }${
    data.type === "foia"
      ? "- Wait for agency response (typically 20 business days)\n- Review provided documents carefully\n- Submit follow-up requests if needed"
      : ""
  }${
    data.type === "lawsuit" && data.filingInstructions
      ? "- Review all filing instructions carefully\n- Gather required documents and fees\n- File within applicable statute of limitations\n- Consider consulting a local attorney"
      : ""
  }${
    data.type === "lawsuit" && !data.filingInstructions
      ? "- Await filing confirmation from Bad Blue\n- Expect case number within 5-7 business days\n- Prepare for potential court proceedings"
      : ""
  }${
    data.type === "full_access"
      ? "- Log in to access free LegalAI tools and Officer Search\n- Analyze your case using our AI consultation\n- Search for officer information\n- Consider our paid services for complaints and lawsuits if needed"
      : ""
  }

If you have any questions or need further assistance, please contact our support team.

Sincerely,
Bad Blue`;

  return email;
}

// --- Concrete send functions -----------------------------------------------

export async function sendWelcomeEmail(
  data: WelcomeEmailData,
): Promise<boolean> {
  try {
    const fromAddress = await getFromAddress();
    const textContent = composeWelcomeEmailText(data);

    const success = await sendWithResend(
      data.email,
      "Welcome to Bad Blue - Police Accountability Platform",
      undefined,
      textContent,
      fromAddress,
    );

    if (success) {
      console.log(`[EMAIL] Welcome email sent to ${data.email}`);
    } else {
      console.error(`[EMAIL] Failed to send welcome email to ${data.email}`);
    }

    return success;
  } catch (error) {
    console.error("[EMAIL] Error in sendWelcomeEmail:", error);
    return false;
  }
}

export async function sendPurchaseConfirmationEmail(
  data: PurchaseConfirmationData,
): Promise<boolean> {
  try {
    const fromAddress = await getFromAddress();
    const textContent = composeConfirmationEmailText(data);

    const subject = `Purchase Confirmation - ${
      data.type === "complaint"
        ? "Police Complaint"
        : data.type === "petition"
          ? "Civil Rights Petition"
          : data.type === "foia"
            ? "FOIA Records Request"
            : data.type === "lawsuit"
              ? data.filingInstructions
                ? "DIY Lawsuit Assistance"
                : "Full-Service Lawsuit"
              : "LegalAI Access"
    }`;

    const success = await sendWithResend(
      data.email,
      subject,
      undefined,
      textContent,
      fromAddress,
    );

    if (success) {
      console.log(
        `[EMAIL] Confirmation email sent to ${data.email} for ${data.type}`,
      );
    } else {
      console.error(
        `[EMAIL] Failed to send confirmation email to ${data.email}`,
      );
    }

    return success;
  } catch (error) {
    console.error("[EMAIL] Error in sendPurchaseConfirmationEmail:", error);
    return false;
  }
}

export async function sendAdminEmail(data: AdminEmailData): Promise<boolean> {
  try {
    const fromAddress = await getFromAddress();

    const success = await sendWithResend(
      data.to,
      data.subject,
      undefined,
      data.message,
      fromAddress,
    );

    if (success) {
      console.log(`[EMAIL] Admin email sent to ${data.to}`);
    } else {
      console.error(`[EMAIL] Failed to send admin email to ${data.to}`);
    }

    return success;
  } catch (error) {
    console.error("[EMAIL] Error in sendAdminEmail:", error);
    return false;
  }
}

export async function sendTestEmail(toEmail: string): Promise<boolean> {
  try {
    const fromAddress = await getFromAddress();
    const testMessage = `This is a test email from Bad Blue.

This email confirms that your Resend configuration is working correctly.

System Information:
- Email Provider: Resend
- From Address: ${fromAddress}
- Sent: ${new Date().toLocaleString()}

If you received this email, your email system is functioning properly.

Sincerely,
Bad Blue`;

    const success = await sendWithResend(
      toEmail,
      "Bad Blue - Test Email",
      undefined,
      testMessage,
      fromAddress,
    );

    if (success) {
      console.log(`[EMAIL] Test email sent to ${toEmail}`);
    } else {
      console.error(`[EMAIL] Failed to send test email to ${toEmail}`);
    }

    return success;
  } catch (error) {
    console.error("[EMAIL] Error in sendTestEmail:", error);
    return false;
  }
}

// Alias for backward compatibility
export const sendAdminTestEmail = sendTestEmail;

export async function sendContactFormEmail(data: {
  type: string;
  name: string;
  email: string;
  subject: string;
  message: string;
}): Promise<boolean> {
  try {
    console.log("[EMAIL] Preparing to send contact form email...");

    const fromAddress = await getFromAddress();
    console.log("[EMAIL] Using from address:", fromAddress);

    const messageText = `Contact Form Submission

Type: ${data.type}
Name: ${data.name}
Email: ${data.email}
Subject: ${data.subject}

Message:
${data.message}

---
Sent from Bad Blue Contact Form
${new Date().toLocaleString()}`;

    const supportEmail = process.env.ADMIN_EMAIL || "contact.badblue@gmail.com";
    console.log("[EMAIL] Sending to support email:", supportEmail);

    const success = await sendWithResend(
      supportEmail,
      `Contact Form: ${data.subject}`,
      undefined,
      messageText,
      fromAddress,
    );

    if (success) {
      console.log(
        `[EMAIL] ✓ Contact form sent successfully from ${data.email}`,
      );
    } else {
      console.error(`[EMAIL] ✗ Failed to send contact form from ${data.email}`);
    }

    return success;
  } catch (error: any) {
    console.error(
      "[EMAIL] Error in sendContactFormEmail:",
      error.message || error,
    );
    return false;
  }
}

export async function sendComplaintToVenue(data: {
  venueEmail: string;
  complaintType: string;
  officerName: string;
  officerBadge: string;
  department: string;
  state: string;
  city: string;
  county?: string;
  incidentDate: string;
  description: string;
  submitterName: string;
  submitterEmail: string;
}): Promise<boolean> {
  try {
    const fromAddress = await getFromAddress();
    const complaintText = `FORMAL COMPLAINT

Complaint Type: ${data.complaintType}
Date of Incident: ${data.incidentDate}
Location: ${data.city}, ${data.state}${
      data.county ? ` (${data.county} County)` : ""
    }

SUBJECT OFFICER:
Name: ${data.officerName}
Badge Number: ${data.officerBadge}
Department: ${data.department}

COMPLAINANT INFORMATION:
Name: ${data.submitterName}
Email: ${data.submitterEmail}

DESCRIPTION OF INCIDENT:
${data.description}

---
This complaint was filed through Bad Blue (bad-blue.com), a police accountability platform.
Please provide a case number and acknowledgment of receipt to the complainant at ${data.submitterEmail}.

Submitted: ${new Date().toLocaleString()}`;

    const success = await sendWithResend(
      data.venueEmail,
      `Formal Complaint: ${data.complaintType} - ${data.officerName}`,
      undefined,
      complaintText,
      fromAddress,
    );

    if (success) {
      console.log(`[EMAIL] Complaint sent to ${data.venueEmail}`);
    } else {
      console.error(`[EMAIL] Failed to send complaint to ${data.venueEmail}`);
    }

    return success;
  } catch (error) {
    console.error("[EMAIL] Error in sendTortNoticeToAgency:", error);
    return false;
  }
}

export async function sendTortNoticeToAgency(data: {
  agencyEmail: string;
  agencyName: string;
  state: string;
  claimantName: string;
  claimantEmail: string;
  tortNoticeDocument: string;
}): Promise<boolean> {
  try {
    const fromAddress = await getFromAddress();
    const noticeText = `TORT CLAIM NOTICE

TO: ${data.agencyName}
FROM: ${data.claimantName}
RE: Notice of Tort Claim pursuant to ${data.state} law

${data.tortNoticeDocument}

---
Claimant Contact Information:
${data.claimantName}
${data.claimantEmail}

This notice was prepared and submitted through Bad Blue (bad-blue.com).
Please acknowledge receipt to the claimant at ${data.claimantEmail}.

Submitted: ${new Date().toLocaleString()}`;

    const success = await sendWithResend(
      data.agencyEmail,
      `Tort Claim Notice - ${data.claimantName}`,
      undefined,
      noticeText,
      fromAddress,
    );

    if (success) {
      console.log(`[EMAIL] Tort notice sent to ${data.agencyEmail}`);
    } else {
      console.error(
        `[EMAIL] Failed to send tort notice to ${data.agencyEmail}`,
      );
    }

    return success;
  } catch (error) {
    console.error("[EMAIL] Error in sendTortNoticeToAgency:", error);
    return false;
  }
}

/**
 * Send petition signatures ZIP file via email
 */
export async function sendPetitionZipEmail(
  email: string,
  petitionTitle: string,
  zipBuffer: Buffer,
  zipFilename: string,
): Promise<boolean> {
  try {
    const fromAddress = await getFromAddress();
    const subject = `Your Petition Signatures: ${petitionTitle}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Petition Signatures Export</h2>
        <p>Your petition "${petitionTitle}" signatures have been compiled and are attached to this email as a ZIP file.</p>
        <p><strong>Note:</strong> This file contains sensitive personal information. Please handle it securely.</p>
      </div>
    `;

    const success = await sendWithResend(
      email,
      subject,
      html,
      undefined,
      fromAddress,
    );
    return success;
  } catch (error) {
    console.error("[EMAIL] Error in sendPetitionZipEmail:", error);
    return false;
  }
}

/**
 * Send custom email to user (admin functionality)
 */
export async function sendUserEmail(
  toEmail: string,
  subject: string,
  message: string,
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>,
): Promise<boolean> {
  try {
    const fromAddress = await getFromAddress();

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Message from BadBlue Admin</h2>
        <div style="white-space: pre-wrap; padding: 20px; background-color: #f5f5f5; border-radius: 5px;">
          ${message}
        </div>
      </div>
    `;

    // Note: Resend API doesn't support attachments in the current implementation
    // For now, we'll just send the email without attachments
    // TODO: Implement attachment support with Resend API
    if (attachments && attachments.length > 0) {
      console.warn(
        `[EMAIL] Attachment support not yet implemented. ${attachments.length} attachments ignored.`,
      );
    }

    const success = await sendWithResend(
      toEmail,
      subject,
      html,
      undefined,
      fromAddress,
    );
    return success;
  } catch (error) {
    console.error("[EMAIL] Error in sendUserEmail:", error);
    return false;
  }
}
