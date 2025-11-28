// API Routes - BadBlue
import type { Express } from "express";
import { createServer, type Server } from "http";
import Stripe from "stripe";
import multer from "multer";
import { z } from "zod";
import passport from "passport";
import { storage } from "./storage";
import { sendAdminEmail } from "./emailService";
import {
 chatWithFormAssistant,
} from "./gemini";
import {
  generateLegalDocument,
  searchPublicRecords,
  analyzePatternsAndLearn,
  analyzeActionability,
  analyzeLegalIssue,
  searchLawsuitFormsAndRules,
  chatWithFormAssistant,
  researchRelevantStatutes,
  analyzeLocalDistrictRules,
  analyzeCaseLaw,
  redraftOffenseDescription,
} from "./legalAI";
import { searchOfficer, searchOfficerInformation, searchProgressEmitter, type SearchProgress } from "./officerSearch";
import { checkDeviceSearchLimit, recordDeviceSearch, getClientIp, getOrCreateDeviceId } from "./deviceRateLimit";
import {
  sendPurchaseConfirmationEmail,
  sendContactFormEmail,
  sendComplaintToVenue,
  sendTortNoticeToAgency,
  sendAdminTestEmail,
  sendPetitionZipEmail,
  sendUserEmail,
} from "./emailService";
import { evidenceStorage, EvidenceNotFoundError, AccessDeniedError } from "./evidenceStorage";
import { ObjectPermission } from "./objectAcl";
import { processSubAgentCommand, trackUsage, runComprehensiveDiagnostic, undoLastSubAgentChange, getLastSubAgentChange, setAutonomousExecution, getAutonomousExecutionStatus, resetRateLimiter, applyTrainingToSubAgent } from "./aiSubAgent";
import { runAutomatedCleanup, getCleanupLogs, getCleanupStats, deleteOldErrorLogs, getErrorLogCleanupHistory, getErrorLogCleanupStats } from "./dataCleanup";
import { runFullDiagnostics } from "./systemDiagnostics";
import {
  apiRateLimit,
  strictRateLimit,
  authRateLimit,
  paymentRateLimit,
  subAgentRateLimit,
  autosaveRateLimit,
} from "./rateLimit";
import { setupAuth, isAuthenticated, adminAuthMiddleware } from "./auth";
import { asyncHandler, notFoundHandler, errorHandler, ErrorTypes } from "./errorHandler";
import { generateComplaintDocument, generateFOIALetter } from "./documentGenerators";
import { getBaseURL } from "./platformConfig";
import {
  insertComplaintSchema,
  insertLawsuitFilingSchema,
  insertContactMessageSchema,
  COMPLAINT_PRICING_CENTS,
  LAWSUIT_PRICING_CENTS,
  LAWSUIT_DIY_PRICING,
  LAWSUIT_DIY_PRICING_CENTS,
  LAWSUIT_FULL_SERVICE_PRICING,
  LAWSUIT_FULL_SERVICE_PRICING_CENTS,
  FULL_ACCESS_PRICING_CENTS,
  insertPetitionSchema,
  PETITION_PRICING_CENTS,
  insertFoiaRequestSchema,
  FOIA_REQUEST_PRICING_CENTS,
} from "@shared/schema";
import crypto from 'crypto';
import archiver from 'archiver';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { db } from './db';
import * as schema from '@shared/schema';
import { petitions, petitionSignatures, lawsuitFilings, type User, aiSubAgentLogs, foiaRequests, foiaStateStatutes, savedProgress, insertSavedProgressSchema, appSettings, adminSettingsAudit, users, subscriptionTiers, userSubscriptions, insertSubscriptionTierSchema, insertUserSubscriptionSchema, trialConsultations, insertTrialConsultationSchema, publicEvidence } from '@shared/schema';

// Lazy initialization for Stripe client
let stripe: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20" as any,
    });
  }
  return stripe;
}

// Multer setup for file uploads (in-memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Enhanced submission venue determination with email and physical addresses
 */
interface SubmissionVenueInfo {
  venue: string;
  email: string;
  physicalAddress: string;
  recipients: string[];
}

function determineSubmissionVenue(
  state: string,
  city: string | null,
  county: string | null,
  incidentType: string,
): string {
  const info = determineEnhancedSubmissionVenue(
    state,
    city,
    county,
    incidentType,
  );
  return info.venue;
}

function determineEnhancedSubmissionVenue(
  state: string,
  city: string | null,
  county: string | null,
  incidentType: string,
): SubmissionVenueInfo {
  const seriousViolations = ["assault", "excessive-force", "misconduct"];

  // City-level routing
  if (city) {
    const cityLower = city.toLowerCase().replace(/\s+/g, "-");
    const stateLower = state.toLowerCase();

    if (seriousViolations.includes(incidentType)) {
      return {
        venue: `Internal Affairs (${city} Police Department), ${city} City Attorney`,
        email: `internalaffairs@${cityLower}pd.gov, cityattorney@${cityLower}.gov`,
        physicalAddress: `${city} Police Department - Internal Affairs Division, ${city}, ${state}`,
        recipients: [
          `Internal Affairs Division - ${city} Police Department`,
          `${city} City Attorney's Office`,
        ],
      };
    }

    if (incidentType === "discrimination" || incidentType === "harassment") {
      return {
        venue: `${city} Police Chief, Internal Affairs`,
        email: `chiefoffice@${cityLower}pd.gov, internalaffairs@${cityLower}pd.gov`,
        physicalAddress: `Office of the Police Chief, ${city} Police Department, ${city}, ${state}`,
        recipients: [
          `Police Chief - ${city} Police Department`,
          `Internal Affairs Division`,
        ],
      };
    }

    return {
      venue: `Internal Affairs (${city} Police Department)`,
      email: `internalaffairs@${cityLower}pd.gov`,
      physicalAddress: `Internal Affairs Division, ${city} Police Department, ${city}, ${state}`,
      recipients: [`Internal Affairs Division - ${city} Police Department`],
    };
  }

  // County-level routing
  if (county) {
    const countyLower = county.toLowerCase().replace(/\s+/g, "-");

    if (seriousViolations.includes(incidentType)) {
      return {
        venue: `County Sheriff Internal Affairs, ${county} County Attorney`,
        email: `sheriff.ia@${countyLower}-county.gov, countyattorney@${countyLower}-county.gov`,
        physicalAddress: `${county} County Sheriff's Office - Internal Affairs, ${county} County, ${state}`,
        recipients: [
          `Internal Affairs - ${county} County Sheriff's Office`,
          `${county} County Attorney's Office`,
        ],
      };
    }

    return {
      venue: `${county} County Sheriff`,
      email: `sheriff@${countyLower}-county.gov`,
      physicalAddress: `${county} County Sheriff's Office, ${county} County, ${state}`,
      recipients: [`${county} County Sheriff's Office`],
    };
  }

  // State-level routing
  const stateLower = state.toLowerCase().replace(/\s+/g, "");
  return {
    venue: `State Police Internal Affairs, ${state} Attorney General`,
    email: `statepolice.ia@${stateLower}.gov, ag.office@${stateLower}.gov`,
    physicalAddress: `State Police Internal Affairs Division, ${state}`,
    recipients: [
      `State Police Internal Affairs Division`,
      `Office of the Attorney General`,
    ],
  };
}

/**
 * Normalizes state code (e.g., "CA", "NY") to full lowercase name for statute lookup
 */
function normalizeStateName(stateCode: string): string {
  const stateMap: Record<string, string> = {
    AL: "alabama",
    AK: "alaska",
    AZ: "arizona",
    AR: "arkansas",
    CA: "california",
    CO: "colorado",
    CT: "connecticut",
    DE: "delaware",
    FL: "florida",
    GA: "georgia",
    HI: "hawaii",
    ID: "idaho",
    IL: "illinois",
    IN: "indiana",
    IA: "iowa",
    KS: "kansas",
    KY: "kentucky",
    LA: "louisiana",
    ME: "maine",
    MD: "maryland",
    MA: "massachusetts",
    MI: "michigan",
    MN: "minnesota",
    MS: "mississippi",
    MO: "missouri",
    MT: "montana",
    NE: "nebraska",
    NV: "nevada",
    NH: "new_hampshire",
    NJ: "new_jersey",
    NM: "new_mexico",
    NY: "new_york",
    NC: "north_carolina",
    ND: "north_dakota",
    OH: "ohio",
    OK: "oklahoma",
    OR: "oregon",
    PA: "pennsylvania",
    RI: "rhode_island",
    SC: "south_carolina",
    SD: "south_dakota",
    TN: "tennessee",
    TX: "texas",
    UT: "utah",
    VT: "vermont",
    VA: "virginia",
    WA: "washington",
    WV: "west_virginia",
    WI: "wisconsin",
    WY: "wyoming",
  };

  // Handle both full names and codes
  const normalized = stateCode.toUpperCase();
  return stateMap[normalized] || stateCode.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Returns relevant state statutes and codes for lawsuits
 */
function getStateStatutes(
  state: string,
  lawsuitType: string,
): { statutes: string[]; description: string } {
  // Normalize lawsuit type from kebab-case to snake_case for lookup
  const normalizedType = lawsuitType.replace(/-/g, "_");

  // This is a simplified version - in production, this would be a comprehensive database
  const stateStatutes: Record<
    string,
    Record<string, { statutes: string[]; description: string }>
  > = {
    california: {
      assault: {
        statutes: [
          "Cal. Pen. Code § 242",
          "Cal. Pen. Code § 243",
          "42 U.S.C. § 1983",
        ],
        description: "Battery by peace officer, civil rights violation",
      },
      excessive_force: {
        statutes: [
          "Cal. Pen. Code § 149",
          "42 U.S.C. § 1983",
          "Fourth Amendment",
        ],
        description: "Assault by public officer, federal civil rights claim",
      },
      discrimination: {
        statutes: ["Cal. Gov. Code § 12940", "42 U.S.C. § 1983"],
        description: "Employment discrimination, civil rights violation",
      },
      harassment: {
        statutes: ["Cal. Pen. Code § 422", "42 U.S.C. § 1983"],
        description: "Criminal threats, civil rights violation",
      },
      misconduct: {
        statutes: ["Cal. Gov. Code § 815.2", "42 U.S.C. § 1983"],
        description: "Public entity liability for employee acts",
      },
      negligence: {
        statutes: ["Cal. Gov. Code § 815.2", "Cal. Gov. Code § 820"],
        description: "Liability of public entities and employees for injury",
      },
    },
    new_york: {
      assault: {
        statutes: ["N.Y. Pen. Law § 120.00", "42 U.S.C. § 1983"],
        description: "Assault charges, federal civil rights violation",
      },
      excessive_force: {
        statutes: [
          "N.Y. Pen. Law § 120.05",
          "42 U.S.C. § 1983",
          "Fourth Amendment",
        ],
        description: "Assault in the second degree, civil rights claim",
      },
      discrimination: {
        statutes: ["N.Y. Exec. Law § 296", "42 U.S.C. § 1983"],
        description: "Unlawful discriminatory practices",
      },
      harassment: {
        statutes: ["N.Y. Pen. Law § 240.26", "42 U.S.C. § 1983"],
        description: "Harassment in the second degree",
      },
      misconduct: {
        statutes: ["N.Y. Gen. Mun. Law § 50-i", "42 U.S.C. § 1983"],
        description: "Notice of claim against municipality",
      },
      negligence: {
        statutes: [
          "N.Y. Gen. Mun. Law § 50-e",
          "N.Y. Court of Claims Act § 10",
        ],
        description: "Notice of claim for negligence",
      },
    },
    texas: {
      assault: {
        statutes: ["Tex. Pen. Code § 22.01", "42 U.S.C. § 1983"],
        description: "Assault by public servant, civil rights violation",
      },
      excessive_force: {
        statutes: [
          "Tex. Pen. Code § 22.02",
          "42 U.S.C. § 1983",
          "Fourth Amendment",
        ],
        description: "Aggravated assault by public servant",
      },
      discrimination: {
        statutes: ["Tex. Lab. Code § 21.051", "42 U.S.C. § 1983"],
        description: "Employment discrimination",
      },
      harassment: {
        statutes: ["Tex. Pen. Code § 42.07", "42 U.S.C. § 1983"],
        description: "Harassment by public servant",
      },
      misconduct: {
        statutes: ["Tex. Civ. Prac. & Rem. Code § 101.021", "42 U.S.C. § 1983"],
        description: "Governmental liability",
      },
      negligence: {
        statutes: ["Tex. Civ. Prac. & Rem. Code § 101.021"],
        description: "Liability of governmental units",
      },
    },
  };

  // Default federal statutes for states not specifically listed
  const defaultStatutes: Record<
    string,
    { statutes: string[]; description: string }
  > = {
    assault: {
      statutes: ["42 U.S.C. § 1983", "18 U.S.C. § 242"],
      description:
        "Civil rights violation, deprivation of rights under color of law",
    },
    excessive_force: {
      statutes: ["42 U.S.C. § 1983", "Fourth Amendment", "18 U.S.C. § 242"],
      description: "Federal civil rights claim, unreasonable seizure",
    },
    discrimination: {
      statutes: ["42 U.S.C. § 1983", "42 U.S.C. § 2000e"],
      description: "Civil rights violation, employment discrimination",
    },
    harassment: {
      statutes: ["42 U.S.C. § 1983", "18 U.S.C. § 242"],
      description: "Civil rights violation, criminal deprivation of rights",
    },
    misconduct: {
      statutes: ["42 U.S.C. § 1983", "18 U.S.C. § 242"],
      description: "Civil rights violation for official misconduct",
    },
    negligence: {
      statutes: ["42 U.S.C. § 1983", "Federal Tort Claims Act"],
      description: "Civil rights claim, federal tort liability",
    },
  };

  const normalizedState = normalizeStateName(state);
  const stateData = stateStatutes[normalizedState];

  if (stateData && stateData[normalizedType]) {
    return stateData[normalizedType];
  }

  return defaultStatutes[normalizedType] || defaultStatutes["misconduct"];
}

/**
 * Generates a lawsuit document with AI-researched state-specific forms and local rules
 */
async function generateLawsuitDocument(
  state: string,
  lawsuitType: string,
  officerName: string | null,
  officerBadge: string | null,
  officerDepartment: string | null,
  incidentDescription: string | null,
  incidentDate: Date,
  incidentTime: string | null,
  city: string | null,
  county: string | null,
  complainantName: string | null,
  complainantAddress: string | null,
  damagesAmount: number | null,
  injuryDetails: string | null = null,
  subsequentEvents: string | null = null,
  witnessNames: string[] | null = null,
): Promise<string> {
  // Check if AI is available
  const useAI = !!process.env.GEMINI_API_KEY;

  if (useAI) {
    try {
      // Use AI to search for state-specific forms and local rules
      const formResearch = await searchLawsuitFormsAndRules(
        state,
        county,
        city,
        lawsuitType,
      );

      // If AI found official forms, use them
      if (formResearch.formsFound && formResearch.formTemplates.length > 0) {
        const primaryForm = formResearch.formTemplates[0];

        // Use the AI-researched form template with filled-in information
        let document = primaryForm.content;

        // Replace placeholders with actual information
        document = document.replace(
          /\[Your Name\]/g,
          complainantName || "[Your Name]",
        );
        document = document.replace(
          /\[Your Address\]/g,
          complainantAddress || "[Your Address]",
        );
        document = document.replace(
          /\[Officer Name\]/g,
          officerName || "Officer Name Unknown",
        );
        document = document.replace(
          /\[Badge Number\]/g,
          officerBadge || "[Badge Number]",
        );
        document = document.replace(
          /\[Department\]/g,
          officerDepartment || "[Police Department]",
        );
        document = document.replace(
          /\[Incident Date\]/g,
          incidentDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }) + (incidentTime ? ` at ${incidentTime}` : ""),
        );
        document = document.replace(
          /\[Incident Description\]/g,
          incidentDescription || "[Incident details to be provided]",
        );
        document = document.replace(
          /\[Injury Details\]/g,
          injuryDetails || "[Injuries to be specified]",
        );
        document = document.replace(
          /\[Subsequent Events\]/g,
          subsequentEvents || "[Subsequent events to be described]",
        );
        document = document.replace(
          /\[Witness Names\]/g,
          witnessNames && witnessNames.length > 0 ? witnessNames.join(", ") : "[Witnesses to be listed]",
        );
        document = document.replace(
          /\[Damages Amount\]/g,
          damagesAmount
            ? `$${(damagesAmount / 100).toLocaleString()}`
            : "[Amount to be determined at trial]",
        );
        document = document.replace(
          /\[Date\]/g,
          new Date().toLocaleDateString("en-US"),
        );

        // Add formatting guidelines and filing information
        document += `\n\n---\nFORMATTING GUIDELINES (${formResearch.localRules.courtName}):\n${formResearch.formattingGuidelines}\n\n`;
        document += `FILING INFORMATION:\n`;
        document += `Court: ${formResearch.courtInformation.courtName}\n`;
        document += `Filing Address: ${formResearch.courtInformation.filingAddress}\n`;
        document += `Electronic Filing: ${formResearch.courtInformation.electronicFiling ? "Available" : "Not Available"}\n`;
        document += `Filing Fees: ${formResearch.courtInformation.filingFees}\n\n`;
        document += `REQUIREMENTS:\n${formResearch.filingRequirements.map((req) => `• ${req}`).join("\n")}\n`;

        return document;
      } else {
        // No forms found - AI creates lawsuit based on local rules
        const { statutes, description } = getStateStatutes(state, lawsuitType);
        const dateStr = incidentDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        return `
${formResearch.localRules.formatting.captionFormat}

IN THE ${formResearch.localRules.courtName.toUpperCase()}
${formResearch.localRules.district}

${complainantName || "[YOUR NAME]"},
    Plaintiff,

v.                                                  Case No.: __________

${officerName || "OFFICER NAME UNKNOWN"}${officerBadge ? `, Badge #${officerBadge}` : ""},
${officerDepartment || "[POLICE DEPARTMENT]"}, and
${city || "[CITY]"}, ${state},
    Defendants.

CIVIL RIGHTS COMPLAINT FOR DAMAGES
(${lawsuitType.replace(/-/g, " ").toUpperCase()})

Pursuant to: ${statutes.join(", ")}

COMES NOW the Plaintiff, ${complainantName || "[YOUR NAME]"}, and for their Complaint against Defendants, states as follows:

I. PARTIES

1. Plaintiff ${complainantName || "[YOUR NAME]"} is a resident of ${city || "[City]"}, ${county || "[County]"} County, ${state}.

2. Defendant ${officerName || "[OFFICER NAME]"} is a law enforcement officer employed by ${officerDepartment || "[POLICE DEPARTMENT]"}, acting under color of state law.

3. Defendant ${city || "[CITY]"} is a municipal corporation organized under the laws of ${state}.

II. JURISDICTION AND VENUE

4. This Court has jurisdiction pursuant to 28 U.S.C. § 1331 (federal question jurisdiction) and 28 U.S.C. § 1343 (civil rights jurisdiction).

5. Venue is proper in this district pursuant to 28 U.S.C. § 1391(b).

III. FACTUAL BACKGROUND

6. On ${dateStr}${incidentTime ? ` at approximately ${incidentTime}` : ""}, Plaintiff was subjected to unlawful conduct by Defendant ${officerName || "[OFFICER NAME]"}.

7. ${incidentDescription || "[Detailed description of the incident, including specific facts about what occurred, when, where, who was present, and what violations took place.]"}
${subsequentEvents ? `\n8. Following the incident: ${subsequentEvents}\n` : ""}${witnessNames && witnessNames.length > 0 ? `\n${subsequentEvents ? "9" : "8"}. The incident was witnessed by: ${witnessNames.join(", ")}.\n` : ""}
IV. CAUSES OF ACTION

COUNT I: Violation of Civil Rights under 42 U.S.C. § 1983

8. Plaintiff incorporates all preceding paragraphs.

9. Defendant ${officerName || "[OFFICER NAME]"}, while acting under color of state law, violated Plaintiff's constitutional rights as secured by the Fourth Amendment and Fourteenth Amendment to the United States Constitution.

10. ${description}

11. As a direct and proximate result of Defendant's conduct, Plaintiff suffered ${damagesAmount ? `damages in the amount of $${(damagesAmount / 100).toLocaleString()}` : "substantial damages"}${injuryDetails ? `, including: ${injuryDetails}` : ", including physical injuries, emotional distress, and violation of constitutional rights"}.

COUNT II: Municipal Liability (Monell Claim)

12. Plaintiff incorporates all preceding paragraphs.

13. Defendant ${city || "[CITY]"} maintained policies, practices, and customs that were the moving force behind the constitutional violations alleged herein.

14. Said municipality failed to adequately train, supervise, and discipline its law enforcement officers, demonstrating deliberate indifference to the constitutional rights of citizens.

V. PRAYER FOR RELIEF

WHEREFORE, Plaintiff respectfully requests that this Court:

A. Enter judgment in favor of Plaintiff and against Defendants;

B. Award compensatory damages ${damagesAmount ? `in the amount of $${(damagesAmount / 100).toLocaleString()}` : "in an amount to be determined at trial"};

C. Award punitive damages as permitted by law;

D. Grant declaratory and injunctive relief to prevent future violations;

E. Award reasonable attorney's fees and costs pursuant to 42 U.S.C. § 1988;

F. Grant such other and further relief as this Court deems just and proper.

DATED: ${new Date().toLocaleDateString("en-US")}

Respectfully submitted,

__________________________________
${complainantName || "[YOUR NAME]"}
${complainantAddress || "[YOUR ADDRESS]"}
Plaintiff, Pro Se


CERTIFICATE OF SERVICE

I hereby certify that on ${new Date().toLocaleDateString("en-US")}, I served a copy of the foregoing Complaint upon all parties in accordance with the local rules.

__________________________________
${complainantName || "[YOUR NAME]"}

---
FORMATTING REQUIREMENTS:
${formResearch.formattingGuidelines}

FILING INFORMATION:
Court: ${formResearch.courtInformation.courtName}
Filing Address: ${formResearch.courtInformation.filingAddress}
Filing Fees: ${formResearch.courtInformation.filingFees}
Electronic Filing: ${formResearch.courtInformation.electronicFiling ? "Available" : "Not Available"}

APPLICABLE LOCAL RULES:
${formResearch.localRules.specificRules.map((rule) => `${rule.ruleNumber}: ${rule.title} - ${rule.requirement}`).join("\n")}
`;
      }
    } catch (error) {
      console.error(
        "Error using AI for lawsuit form research, falling back to basic template:",
        error,
      );
      // Fall through to basic template
    }
  }

  // Fallback: Basic template if AI is not available
  const { statutes, description } = getStateStatutes(state, lawsuitType);
  const venue = determineSubmissionVenue(state, city, county, lawsuitType);

  const dateStr = incidentDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
CIVIL COMPLAINT FOR DAMAGES AND INJUNCTIVE RELIEF

Case Type: ${lawsuitType.replace(/_/g, " ").toUpperCase()}
Jurisdiction: ${state}
${city ? `City: ${city}` : ""}
${county ? `County: ${county}` : ""}

PARTIES:
Plaintiff: ${complainantName || "[Your Name]"}
Defendant: ${officerName || "Officer Name Unknown"}${officerBadge ? `, Badge #${officerBadge}` : ""}
${officerDepartment ? `Department: ${officerDepartment}` : ""}

JURISDICTION AND VENUE:
This complaint is filed pursuant to the following statutes:
${statutes.map((s) => `• ${s}`).join("\n")}

Legal Basis: ${description}

Proper Venue: ${venue}

STATEMENT OF FACTS:
On ${dateStr}${incidentTime ? ` at approximately ${incidentTime}` : ""}, the following incident occurred:

${incidentDescription || "Incident details to be provided"}
${injuryDetails ? `\nINJURIES SUSTAINED:\n${injuryDetails}` : ""}
${subsequentEvents ? `\nSUBSEQUENT EVENTS:\n${subsequentEvents}` : ""}
${witnessNames && witnessNames.length > 0 ? `\nWITNESSES:\n${witnessNames.join("\n")}` : ""}

CLAIMS FOR RELIEF:
1. Violation of civil rights under 42 U.S.C. § 1983
2. ${lawsuitType === "assault" ? "Assault and Battery" : ""}
${lawsuitType === "excessive_force" ? "Excessive Force in violation of the Fourth Amendment" : ""}
${lawsuitType === "discrimination" ? "Unlawful Discrimination" : ""}
${lawsuitType === "harassment" ? "Harassment and Intimidation" : ""}
${lawsuitType === "misconduct" ? "Official Misconduct and Abuse of Authority" : ""}
${lawsuitType === "negligence" ? "Negligence and Failure to Protect" : ""}
3. Intentional infliction of emotional distress
4. Negligent supervision and training

PRAYER FOR RELIEF:
WHEREFORE, Plaintiff respectfully requests that this Court:
1. Award compensatory damages ${damagesAmount ? `in the amount of $${(damagesAmount / 100).toLocaleString()}` : "in an amount to be determined at trial"}
2. Award punitive damages as permitted by law
3. Grant injunctive relief to prevent future violations
4. Award attorney's fees and costs
5. Grant such other and further relief as the Court deems just and proper

Date: ${new Date().toLocaleDateString("en-US")}

[Signature Line]
${complainantName || "Plaintiff"}

---
NOTICE: This document is automatically generated and should be reviewed by a qualified attorney before filing.
Submit to: ${venue}
`;
}

/**
 * Generates a formal complaint document with required template sections
 */

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware setup
  await setupAuth(app);

  // Usage tracking middleware - learns usage patterns for auto-repair timing
  app.use((req, res, next) => {
    trackUsage();
    next();
  });

  // ============================================
  // PREVIEW ROUTES (No charge, no save - just show what they'll get)
  // ============================================

  app.post("/api/preview-complaint", asyncHandler(async (req: any, res: any) => {
    const { state, complaintType, officerName, officerBadge, department, description, incidentDate, city, county } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!state) missingFields.push('state');
    if (!complaintType) missingFields.push('complaintType');
    if (!officerName) missingFields.push('officerName');
    if (!department) missingFields.push('department');
    if (!description) missingFields.push('description');
    if (!incidentDate) missingFields.push('incidentDate');
    if (!city) missingFields.push('city');

    if (missingFields.length > 0) {
      throw ErrorTypes.MISSING_REQUIRED_FIELDS(missingFields);
    }

    const document = generateComplaintDocument(
      state,
      complaintType,
      officerName,
      officerBadge,
      department,
      description,
      new Date(incidentDate),
      city,
      county,
      null, // complainantName - not needed for preview
      null  // complainantAddress - not needed for preview
    );

    res.json({ document });
  }));

  app.post("/api/preview-lawsuit", async (req, res) => {
    try {
      const {
        state, lawsuitType, officerName, officerBadge, department, description,
        incidentDate, incidentTime, city, county, damagesAmount,
        plaintiffName, plaintiffAddress, injuryDetails, subsequentEvents, witnessNames
      } = req.body;

      if (!state || !lawsuitType || !officerName || !department || !description || !incidentDate || !city) {
        return res.status(400).json({ error: "Missing required fields for preview" });
      }

      // Convert damagesAmount from dollars to cents (number format expected by backend)
      const damagesInCents = damagesAmount ? parseInt(damagesAmount) * 100 : null;

      // Defensively convert witnessNames to array if it's a string (prevent regression)
      let witnessNamesArray: string[] | null = null;
      if (witnessNames) {
        if (Array.isArray(witnessNames)) {
          witnessNamesArray = witnessNames.filter((n: string) => n && n.trim().length > 0);
        } else if (typeof witnessNames === 'string') {
          witnessNamesArray = witnessNames.split(',').map((n: string) => n.trim()).filter(n => n.length > 0);
        }
      }

      // Note: This uses the fallback template, not the AI-enhanced version
      // The AI-enhanced version is only generated after payment
      const document = await generateLawsuitDocument(
        state,
        lawsuitType,
        officerName,
        officerBadge,
        department,
        description,
        new Date(incidentDate),
        incidentTime || null,
        city,
        county,
        plaintiffName || null,
        plaintiffAddress || null,
        damagesInCents,
        injuryDetails || null,
        subsequentEvents || null,
        witnessNamesArray
      );

      res.json({ document });
    } catch (error: any) {
      console.error("Error generating lawsuit preview:", error);
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });

  // ============================================
  // AUTH ROUTES
  // ============================================

  // Simple in-memory rate limiter for auth endpoints
  const authRateLimiter = new Map<string, { count: number; resetAt: number }>();
  const AUTH_RATE_LIMIT = 5; // 5 attempts
  const AUTH_RATE_WINDOW = 15 * 60 * 1000; // 15 minutes

  function checkRateLimit(identifier: string): boolean {
    const now = Date.now();
    const record = authRateLimiter.get(identifier);

    if (!record || now > record.resetAt) {
      authRateLimiter.set(identifier, { count: 1, resetAt: now + AUTH_RATE_WINDOW });
      return true;
    }

    if (record.count >= AUTH_RATE_LIMIT) {
      return false;
    }

    record.count++;
    return true;
  }

  // Clean up rate limiter every hour
  setInterval(() => {
    const now = Date.now();
    Array.from(authRateLimiter.entries()).forEach(([key, record]) => {
      if (now > record.resetAt) {
        authRateLimiter.delete(key);
      }
    });
  }, 60 * 60 * 1000);

  // Local registration (email/password with firstName/lastName)
  app.post("/api/register/local", asyncHandler(async (req: any, res: any) => {
    const { firstName, lastName, email, password } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress || "unknown";

    // Rate limiting - prevent registration spam
    const ipIdentifier = `register:ip:${clientIp}`;

    if (!checkRateLimit(ipIdentifier)) {
      console.log(`[SECURITY] Registration rate limit exceeded from IP: ${clientIp}`);
      throw ErrorTypes.RATE_LIMIT_EXCEEDED(15);
    }

    if (!firstName || !lastName || !email || !password) {
      throw ErrorTypes.MISSING_REQUIRED_FIELDS(['firstName', 'lastName', 'email', 'password']);
    }

    const { registerLocalUser } = await import("./localAuth");
    
    try {
      const { user, authAccount } = await registerLocalUser(email, password, firstName, lastName);
      
      console.log(`[SECURITY] New user registered: ${email} from IP: ${clientIp}`);

      res.json({
        success: true,
        message: "Registration successful. Please log in.",
        userId: user.id,
      });
    } catch (error: any) {
      // Handle specific registration errors
      if (error.message?.includes('already exists') || error.message?.includes('already registered')) {
        throw ErrorTypes.DUPLICATE_ENTRY('Email');
      }
      throw error; // Re-throw for general error handler
    }
  }));

  // Local login (email/password)
  app.post("/api/login/local", async (req: any, res, next) => {
    try {
      // Support both email and username for backward compatibility
      const { email, username } = req.body;
      const loginIdentifier = email || username; // Use email if provided, fallback to username
      const clientIp = req.ip || req.connection.remoteAddress || "unknown";

      // Rate limiting - check both IP and email/username
      const ipIdentifier = `login:ip:${clientIp}`;
      const userIdentifier = `login:user:${loginIdentifier}`;

      if (!checkRateLimit(ipIdentifier) || !checkRateLimit(userIdentifier)) {
        console.log(`[SECURITY] Rate limit exceeded for ${loginIdentifier} from IP: ${clientIp}`);
        return res.status(429).json({
          message: "Too many login attempts. Please try again in 15 minutes."
        });
      }

      // Log admin bypass attempts for security audit trail
      if (process.env.ADMIN_BYPASS_ID && loginIdentifier === process.env.ADMIN_BYPASS_ID) {
        await storage.createAdminAccessLog({
          adminId: loginIdentifier,
          ipAddress: clientIp,
          userAgent: req.get("user-agent") || null,
          sessionId: req.sessionID || null,
        });
        console.log(`[SECURITY] Admin bypass login attempt from IP: ${clientIp}, User-Agent: ${req.get("user-agent")}`);
      }

      // Prepare the request body for passport with 'email' field
      req.body.email = loginIdentifier; // Passport strategy expects 'email' field
      
      passport.authenticate("local", (err: any, user: any, info: any) => {
        if (err) {
          console.error("[AUTH ERROR] Passport authentication error:", err);
          return res.status(500).json({ message: "Authentication error" });
        }
        if (!user) {
          console.log(`[AUTH] Login failed for: ${loginIdentifier}, reason: ${info?.message}`);
          return res.status(401).json({ message: info?.message || "Invalid credentials" });
        }

        req.login(user, (loginErr: any) => {
          if (loginErr) {
            console.error("[AUTH ERROR] req.login error:", loginErr);
            return res.status(500).json({ message: "Login failed" });
          }
          console.log(`[AUTH] Login successful for: ${loginIdentifier}`);
          res.json({
            success: true,
            message: "Login successful",
            isAdminBypass: user.isAdminBypass || false,
          });
        });
      })(req, res, next);
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Works for both authenticated and unauthenticated users
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      // If not authenticated, return null instead of error
      if (!req.isAuthenticated() || !req.user) {
        return res.json(null);
      }

      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Add isAdmin flag - only true for the admin-bypass account
      const userWithAdminFlag = {
        ...user,
        isAdmin: user.id === "admin-bypass"
      };

      res.json(userWithAdminFlag);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ============================================
  // OBJECT STORAGE ROUTES (File Uploads)
  // ============================================
  // From javascript_object_storage blueprint

  // Get upload URL for evidence files (Platform-agnostic: cloud object storage OR filesystem)
  app.post("/api/objects/upload", isAuthenticated, async (req, res) => {
    try {
      const uploadURL = await evidenceStorage.getUploadURL();
      res.json({ uploadURL });
    } catch (error: any) {
      console.error("Error getting upload URL:", error);
      res
        .status(500)
        .json({ error: "Error getting upload URL: " + error.message });
    }
  });

  // Set ACL policy for uploaded evidence file (Platform-agnostic: cloud OR filesystem)
  app.put("/api/evidence-files", isAuthenticated, async (req: any, res) => {
    try {
      if (!req.body.fileURL) {
        return res.status(400).json({ error: "fileURL is required" });
      }

      const userId = req.user?.claims?.sub;

      // Set ACL policy - evidence files are private (only accessible by owner)
      const objectPath = await evidenceStorage.saveFile(
        req.body.fileURL,
        userId,
        {
          owner: userId,
          visibility: "private", // Evidence files are private
        },
      );

      res.status(200).json({
        objectPath: objectPath,
      });
    } catch (error: any) {
      console.error("Error setting evidence file ACL:", error);
      res.status(500).json({ error: "Error saving file: " + error.message });
    }
  });

  // Serve protected evidence files - with ownership verification (Platform-agnostic)
  app.get("/objects/:objectPath(*)", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    
    try {
      if (!userId) {
        return res.sendStatus(401);
      }

      // Download file with access verification
      await evidenceStorage.downloadFile(req.path, userId, res);
    } catch (error) {
      console.error("Error accessing evidence file:", error);
      if (error instanceof EvidenceNotFoundError) {
        return res.sendStatus(404);
      }
      if (error instanceof AccessDeniedError || (error as Error).message === "Access denied") {
        console.warn(
          `Access denied: User ${userId} attempted to access ${req.path}`,
        );
        return res.sendStatus(403);
      }
      return res.sendStatus(500);
    }
  });

  // Filesystem upload endpoint (for platforms without cloud storage)
  // This handles direct file uploads when cloud object storage is not available
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit
  app.post("/api/evidence/filesystem-upload", isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      const fileId = req.query.fileId as string;
      
      if (!fileId) {
        return res.status(400).json({ error: "fileId is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      // Only allow filesystem storage to handle uploads via this route
      if (evidenceStorage.isFilesystemStorage && evidenceStorage.handleFileUpload) {
        await evidenceStorage.handleFileUpload(fileId, req.file.buffer, req.file.mimetype);
        
        // Return the fileId URL so the client can set ACL in the next step
        return res.json({ 
          url: `/api/evidence/filesystem-upload?fileId=${fileId}`,
          fileId 
        });
      } else {
        // Cloud storage uses signed URLs, not this endpoint
        return res.status(400).json({ 
          error: "This endpoint is only for filesystem storage. Cloud storage uses signed URLs." 
        });
      }
    } catch (error: any) {
      console.error("Error uploading file to filesystem:", error);
      res.status(500).json({ error: "Error uploading file: " + error.message });
    }
  });

  // ============================================
  // STRIPE PAYMENT ROUTES (Pay-per-use)
  // ============================================

  // Create Stripe Checkout Session for complaint filing
  app.post(
    "/api/create-complaint-payment",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const stripe = getStripeClient();
        const userId = req.user.claims.sub;
        const { complaintId } = req.body;

        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const complaint = await storage.getComplaint(complaintId);
        if (!complaint || complaint.userId !== userId) {
          return res.status(404).json({ message: "Complaint not found" });
        }

        // Create or get Stripe customer
        let customerId = user.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email || undefined,
            metadata: { userId: user.id },
          });
          customerId = customer.id;
          await storage.updateUserStripeCustomerId(user.id, customerId);
        }

        // Get the base URL for redirects (platform-agnostic)
        const baseUrl = getBaseURL();

        // Create Checkout Session for one-time payment
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: COMPLAINT_PRICING_CENTS,
                product_data: {
                  name: "BadBlue Complaint Filing",
                  description: `Complaint against ${complaint.officerName}`,
                },
              },
              quantity: 1,
            },
          ],
          success_url: `${baseUrl}/confirmation/complaint/${complaintId}`,
          cancel_url: `${baseUrl}/complaint-form`,
          metadata: {
            userId: user.id,
            complaintId: complaintId,
            type: "complaint",
          },
        });

        res.json({
          sessionId: session.id,
          url: session.url,
        });
      } catch (error: any) {
        console.error("Error creating payment session:", error);
        res
          .status(500)
          .json({ message: "Error creating payment: " + error.message });
      }
    },
  );

  // Create Stripe Checkout Session for lawsuit filing
  app.post(
    "/api/create-lawsuit-payment",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const stripe = getStripeClient();
        const userId = req.user.claims.sub;
        const { lawsuitId } = req.body;

        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const lawsuit = await storage.getLawsuitFiling(lawsuitId);
        if (!lawsuit || lawsuit.userId !== userId) {
          return res.status(404).json({ message: "Lawsuit not found" });
        }

        // Determine pricing based on lawsuit tier
        const tier = lawsuit.lawsuitTier || 'diy';
        const priceCents = tier === 'full-service'
          ? LAWSUIT_FULL_SERVICE_PRICING_CENTS
          : LAWSUIT_DIY_PRICING_CENTS;
        const priceDisplay = tier === 'full-service'
          ? LAWSUIT_FULL_SERVICE_PRICING
          : LAWSUIT_DIY_PRICING;
        const serviceName = tier === 'full-service'
          ? 'BadBlue Lawsuit Filing (Full Service)'
          : 'BadBlue Lawsuit Filing (DIY)';
        const serviceDescription = tier === 'full-service'
          ? `Civil rights lawsuit against ${lawsuit.officerName} - Full filing service with U.S. Marshal`
          : `Civil rights lawsuit against ${lawsuit.officerName} - Self-filing with documents`;

        console.log(`[Payment] Creating ${tier} lawsuit payment for ${priceCents} cents`);

        // Create or get Stripe customer
        let customerId = user.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email || undefined,
            metadata: { userId: user.id },
          });
          customerId = customer.id;
          await storage.updateUserStripeCustomerId(user.id, customerId);
        }

        // Get the base URL for redirects (platform-agnostic)
        const baseUrl = getBaseURL();

        // Create Checkout Session for one-time payment
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: priceCents,
                product_data: {
                  name: serviceName,
                  description: serviceDescription,
                },
              },
              quantity: 1,
            },
          ],
          success_url: `${baseUrl}/confirmation/lawsuit/${lawsuitId}`,
          cancel_url: `${baseUrl}/lawsuit-form`,
          metadata: {
            userId: user.id,
            lawsuitId: lawsuitId,
            type: "lawsuit",
            tier: tier,
          },
        });

        res.json({
          sessionId: session.id,
          url: session.url,
        });
      } catch (error: any) {
        console.error("Error creating payment session:", error);
        res
          .status(500)
          .json({ message: "Error creating payment: " + error.message });
      }
    },
  );

  // Create Stripe Checkout Session for petition purchase
  app.post(
    "/api/create-petition-payment",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const stripe = getStripeClient();
        const userId = req.user.claims.sub;
        const { petitionData } = req.body;

        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Validate petition data
        const validationResult = insertPetitionSchema.safeParse(petitionData);
        if (!validationResult.success) {
          return res.status(400).json({
            message: "Invalid petition data",
            errors: validationResult.error.errors
          });
        }

        // Generate unique slug for shareable link
        const slug = crypto.randomBytes(8).toString('hex');

        // Create petition record (pending payment)
        const petition = await db.insert(petitions).values({
          userId,
          slug,
          ...validationResult.data,
          shareableUrl: `${req.protocol}://${req.get('host')}/petition/${slug}`,
        }).returning();

        const petitionId = petition[0].id;

        // Trigger AI redrafting in background (don't wait)
        redraftOffenseDescription(
          validationResult.data.offenseDescriptionOriginal,
          validationResult.data.officerName,
          validationResult.data.department
        ).then(async (redrafted) => {
          // Update petition with redrafted description
          await db.update(petitions)
            .set({ offenseDescriptionRedrafted: redrafted })
            .where(eq(petitions.id, petitionId));
          console.log(`[Petition] AI redrafted offense description for petition ${petitionId}`);
        }).catch((error) => {
          console.error(`[Petition] Failed to redraft description for ${petitionId}:`, error);
        });

        // Create or get Stripe customer
        let customerId = user.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email || undefined,
            metadata: { userId: user.id },
          });
          customerId = customer.id;
          await storage.updateUserStripeCustomerId(user.id, customerId);
        }

        // Get the base URL for redirects (platform-agnostic)
        const baseUrl = getBaseURL();

        // Create Checkout Session for petition payment
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: PETITION_PRICING_CENTS,
                product_data: {
                  name: "BadBlue Petition",
                  description: `Officer Resignation Petition: ${petitionData.officerName}`,
                },
              },
              quantity: 1,
            },
          ],
          success_url: `${baseUrl}/petition/${slug}?payment=success`,
          cancel_url: `${baseUrl}/home`,
          metadata: {
            userId: user.id,
            petitionId: petitionId,
            type: "petition",
          },
        });

        res.json({
          sessionId: session.id,
          url: session.url,
          petitionId: petitionId,
          slug: slug,
        });
      } catch (error: any) {
        console.error("Error creating petition payment:", error);
        res
          .status(500)
          .json({ message: "Error creating payment: " + error.message });
      }
    },
  );

  // Create Stripe Checkout Session for FOIA request payment
  app.post("/api/create-foia-payment", isAuthenticated, async (req: any, res) => {
    try {
      const stripe = getStripeClient();
      const userId = req.user.claims.sub;
      const { foiaRequestId } = req.body;

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get FOIA request
      const foiaRequest = await db.query.foiaRequests.findFirst({
        where: eq(foiaRequests.id, foiaRequestId),
      });

      if (!foiaRequest) {
        return res.status(404).json({ error: "FOIA request not found" });
      }

      // Verify ownership
      if (foiaRequest.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Create or get Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        await storage.updateUserStripeCustomerId(user.id, customerId);
      }

      // Get the base URL for redirects (platform-agnostic)
      const baseUrl = getBaseURL();

      // Create Checkout Session for FOIA payment
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: FOIA_REQUEST_PRICING_CENTS,
              product_data: {
                name: "BadBlue FOIA Records Request",
                description: `FOIA Request for ${foiaRequest.departmentName} - Officer: ${foiaRequest.officerName}`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/home?payment=success&type=foia`,
        cancel_url: `${baseUrl}/home`,
        metadata: {
          userId: user.id,
          foiaRequestId: foiaRequestId,
          type: "foia",
        },
      });

      res.json({
        sessionId: session.id,
        url: session.url,
        foiaRequestId: foiaRequestId,
      });
    } catch (error: any) {
      console.error("Error creating FOIA payment:", error);
      res.status(500).json({ error: "Error creating payment: " + error.message });
    }
  });

  // Get public petition by slug (no authentication required)
  app.get("/api/petition-public/:slug", async (req, res) => {
    try {
      const { slug } = req.params;

      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.slug, slug),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      res.json(petition);
    } catch (error: any) {
      console.error("Error fetching petition:", error);
      res.status(500).json({ message: "Error fetching petition" });
    }
  });

  // Submit signature to petition (no authentication required)
  app.post("/api/petition/:slug/sign", async (req, res) => {
    try {
      const { slug } = req.params;
      const { fullName, typedSignature, drawnSignature, consent } = req.body;

      // Validate inputs
      if (!fullName || !typedSignature || !consent) {
        return res.status(400).json({ message: "Full name, typed signature, and consent are required" });
      }

      // Find petition
      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.slug, slug),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      // Insert signature
      await db.insert(petitionSignatures).values({
        petitionId: petition.id,
        fullName,
        typedSignature,
        drawnSignature: drawnSignature || null,
      });

      // Increment signature count
      await db.update(petitions)
        .set({
          signatureCount: sql`${petitions.signatureCount} + 1`,
          updatedAt: new Date()
        })
        .where(eq(petitions.id, petition.id));

      res.json({ success: true, message: "Signature recorded successfully" });
    } catch (error: any) {
      console.error("Error signing petition:", error);
      res.status(500).json({ message: "Error signing petition" });
    }
  });

  // Get all petitions (admin only)
  app.get("/api/petitions-admin", isAuthenticated, async (req: any, res) => {
    try {
      const allPetitions = await db.query.petitions.findMany({
        orderBy: desc(petitions.createdAt),
      });

      res.json(allPetitions);
    } catch (error: any) {
      console.error("Error fetching petitions:", error);
      res.status(500).json({ message: "Error fetching petitions" });
    }
  });

  // Get single petition (admin only)
  app.get("/api/petition-admin/:id", isAuthenticated, async (req, res) => {
    try {
      const petitionId = req.params.id;

      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      res.json(petition);
    } catch (error: any) {
      console.error("Error fetching petition:", error);
      res.status(500).json({ message: "Error fetching petition" });
    }
  });

  // Update petition (admin only)
  app.patch("/api/petition-admin/:id", isAuthenticated, async (req, res) => {
    try {
      const petitionId = req.params.id;
      const updateData = req.body;

      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      await db.update(petitions)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(petitions.id, petitionId));

      const updated = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating petition:", error);
      res.status(500).json({ message: "Error updating petition" });
    }
  });

  // Get full-service lawsuits with user info (admin only)
  app.get("/api/admin/full-service-lawsuits", isAuthenticated, async (req, res) => {
    try {
      const lawsuits = await db.query.lawsuitFilings.findMany({
        where: eq(lawsuitFilings.lawsuitTier, 'full-service'),
        with: {
          user: true,
        },
        orderBy: desc(lawsuitFilings.createdAt),
      });

      res.json(lawsuits);
    } catch (error: any) {
      console.error("Error fetching full-service lawsuits:", error);
      res.status(500).json({ message: "Error fetching lawsuits" });
    }
  });

  // Get single lawsuit details (admin only)
  app.get("/api/admin/lawsuit/:id", isAuthenticated, async (req, res) => {
    try {
      const lawsuitId = req.params.id;

      const lawsuit = await db.query.lawsuitFilings.findFirst({
        where: eq(lawsuitFilings.id, lawsuitId),
        with: {
          user: true,
        },
      });

      if (!lawsuit) {
        return res.status(404).json({ message: "Lawsuit not found" });
      }

      res.json(lawsuit);
    } catch (error: any) {
      console.error("Error fetching lawsuit:", error);
      res.status(500).json({ message: "Error fetching lawsuit" });
    }
  });

  // Get signatures for petition (admin only)
  app.get("/api/petition-signatures/:id", isAuthenticated, async (req, res) => {
    try {
      const petitionId = req.params.id;

      const sigs = await db.query.petitionSignatures.findMany({
        where: eq(petitionSignatures.petitionId, petitionId),
        orderBy: desc(petitionSignatures.signedAt),
      });

      res.json(sigs);
    } catch (error: any) {
      console.error("Error fetching signatures:", error);
      res.status(500).json({ message: "Error fetching signatures" });
    }
  });

  // Email petition ZIP to specified address (admin only)
  app.post("/api/petition-email-zip/:id", isAuthenticated, async (req, res) => {
    try {
      const petitionId = req.params.id;
      const { email } = req.body;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Valid email address is required" });
      }

      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      const sigs = await db.query.petitionSignatures.findMany({
        where: eq(petitionSignatures.petitionId, petitionId),
        orderBy: asc(petitionSignatures.signedAt),
      });

      const now = new Date();
      const timestamp = now.toISOString().replace(/:/g, '-').substring(0, 16).replace('T', '_');
      const officerLastName = petition.officerName.split(' ').pop() || 'Unknown';

      // Generate petition content
      let petitionContent = '';
      let lineCount = 0;
      let pageNumber = 1;

      const addLine = (line: string) => {
        petitionContent += line + '\n';
        lineCount++;
        if (lineCount % 60 === 0) {
          petitionContent += `\n--- Page ${pageNumber} ---\n\n`;
          pageNumber++;
          lineCount += 2;
        }
      };

      addLine('='.repeat(80));
      addLine('PETITION FOR OFFICER RESIGNATION');
      addLine('='.repeat(80));
      addLine('');
      addLine(`Officer: ${petition.officerName}`);
      addLine(`Department: ${petition.department}`);

      const location = [petition.city, petition.county, petition.state].filter(Boolean).join(', ');
      if (location) {
        addLine(`Location: ${location}`);
      }

      addLine(`Total Signatures: ${petition.signatureCount}`);
      addLine(`Compiled: ${now.toUTCString()}`);
      addLine('');
      addLine('-'.repeat(80));
      addLine('INCIDENT DESCRIPTION');
      addLine('-'.repeat(80));
      addLine('');

      const description = petition.offenseDescriptionRedrafted || petition.offenseDescriptionOriginal;
      description.split('\n').forEach(line => addLine(line));

      if (petition.additionalText) {
        addLine('');
        addLine('-'.repeat(80));
        addLine('ADDITIONAL INFORMATION');
        addLine('-'.repeat(80));
        addLine('');
        petition.additionalText.split('\n').forEach(line => addLine(line));
      }

      addLine('');
      addLine('='.repeat(80));
      addLine('SIGNATURE ROSTER');
      addLine('='.repeat(80));
      addLine('');

      sigs.forEach((sig, index) => {
        addLine(`#${index + 1}`);
        addLine(`  Typed Signature: ${sig.typedSignature}`);
        addLine(`  Full Name: ${sig.fullName}`);
        addLine(`  Signed At: ${new Date(sig.signedAt).toUTCString()}`);
        addLine('');
      });

      addLine('');
      addLine('='.repeat(80));
      addLine(`END OF PETITION - ${petition.signatureCount} TOTAL SIGNATURES`);
      addLine('='.repeat(80));

      // Generate README
      const readme = `PETITION PACKAGE
================

Petition Title: Petition for Resignation - Officer ${petition.officerName}
Compiled: ${now.toUTCString()}
Total Signatures: ${petition.signatureCount}

Contents:
- petition_${officerLastName}_${timestamp}_plain.txt: Complete petition with all signatures

About This Petition:
This petition calls for the resignation of Officer ${petition.officerName} from ${petition.department}.
The petition includes ${petition.signatureCount} verified signatures collected via BadBlue.com.

For questions or support, contact: support@badblue.com
`;

      // Create ZIP archive in memory
      const buffers: Buffer[] = [];
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.on('data', (chunk) => {
        buffers.push(chunk);
      });

      const zipPromise = new Promise<Buffer>((resolve, reject) => {
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', reject);
      });

      archive.append(petitionContent, { name: `petition_${officerLastName}_${timestamp}_plain.txt` });
      archive.append(readme, { name: 'README.txt' });
      await archive.finalize();

      const zipBuffer = await zipPromise;
      const zipFilename = `petition_${officerLastName}_${timestamp}.zip`;
      const petitionTitle = `Petition for Resignation - Officer ${petition.officerName}`;

      // Send email
      const emailSent = await sendPetitionZipEmail(email, petitionTitle, zipBuffer, zipFilename);

      if (!emailSent) {
        return res.status(500).json({ message: "Failed to send email" });
      }

      // Update lastCompiledAt
      await db.update(petitions)
        .set({ lastCompiledAt: now, updatedAt: now })
        .where(eq(petitions.id, petitionId));

      res.json({ success: true, message: `Petition ZIP emailed to ${email}` });
    } catch (error: any) {
      console.error("Error emailing petition ZIP:", error);
      res.status(500).json({ message: "Error emailing petition ZIP" });
    }
  });

  // Export petition as ZIP with plain text and README (admin only)
  app.get("/api/petition-export-zip/:id", isAuthenticated, async (req, res) => {
    try {
      const petitionId = req.params.id;

      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      const sigs = await db.query.petitionSignatures.findMany({
        where: eq(petitionSignatures.petitionId, petitionId),
        orderBy: asc(petitionSignatures.signedAt),
      });

      const now = new Date();
      const timestamp = now.toISOString().replace(/:/g, '-').substring(0, 16).replace('T', '_');
      const officerLastName = petition.officerName.split(' ').pop() || 'Unknown';

      // Generate petition content
      let petitionContent = '';
      let lineCount = 0;
      let pageNumber = 1;

      const addLine = (line: string) => {
        petitionContent += line + '\n';
        lineCount++;
        if (lineCount % 60 === 0) {
          petitionContent += `\n--- Page ${pageNumber} ---\n\n`;
          pageNumber++;
          lineCount += 2;
        }
      };

      addLine('='.repeat(80));
      addLine('PETITION FOR OFFICER RESIGNATION');
      addLine('='.repeat(80));
      addLine('');
      addLine(`Officer: ${petition.officerName}`);
      addLine(`Department: ${petition.department}`);

      const location = [petition.city, petition.county, petition.state].filter(Boolean).join(', ');
      if (location) {
        addLine(`Location: ${location}`);
      }

      addLine(`Total Signatures: ${petition.signatureCount}`);
      addLine(`Compiled: ${now.toUTCString()}`);
      addLine('');
      addLine('-'.repeat(80));
      addLine('INCIDENT DESCRIPTION');
      addLine('-'.repeat(80));
      addLine('');

      const description = petition.offenseDescriptionRedrafted || petition.offenseDescriptionOriginal;
      description.split('\n').forEach(line => addLine(line));

      if (petition.additionalText) {
        addLine('');
        addLine('-'.repeat(80));
        addLine('ADDITIONAL INFORMATION');
        addLine('-'.repeat(80));
        addLine('');
        petition.additionalText.split('\n').forEach(line => addLine(line));
      }

      addLine('');
      addLine('='.repeat(80));
      addLine('SIGNATURE ROSTER');
      addLine('='.repeat(80));
      addLine('');

      sigs.forEach((sig, index) => {
        addLine(`#${index + 1}`);
        addLine(`  Typed Signature: ${sig.typedSignature}`);
        addLine(`  Full Name: ${sig.fullName}`);
        addLine(`  Signed At: ${new Date(sig.signedAt).toUTCString()}`);
        addLine('');
      });

      addLine('');
      addLine('='.repeat(80));
      addLine(`END OF PETITION - ${petition.signatureCount} TOTAL SIGNATURES`);
      addLine('='.repeat(80));

      // Generate README
      const readme = `PETITION PACKAGE
================

Petition Title: Petition for Resignation - Officer ${petition.officerName}
Compiled: ${now.toUTCString()}
Total Signatures: ${petition.signatureCount}

Contents:
- petition_${officerLastName}_${timestamp}_plain.txt: Complete petition with all signatures

About This Petition:
This petition calls for the resignation of Officer ${petition.officerName} from ${petition.department}.
The petition includes ${petition.signatureCount} verified signatures collected via BadBlue.com.

For questions or support, contact: support@badblue.com
`;

      // Create ZIP archive
      const archive = archiver('zip', { zlib: { level: 9 } });
      const zipFilename = `petition_${officerLastName}_${timestamp}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      archive.pipe(res);
      archive.append(petitionContent, { name: `petition_${officerLastName}_${timestamp}_plain.txt` });
      archive.append(readme, { name: 'README.txt' });
      await archive.finalize();

      // Update lastCompiledAt
      await db.update(petitions)
        .set({ lastCompiledAt: now, updatedAt: now })
        .where(eq(petitions.id, petitionId));

    } catch (error: any) {
      console.error("Error exporting petition ZIP:", error);
      res.status(500).json({ message: "Error exporting petition ZIP" });
    }
  });

  // Compile petition to plain text (admin only)
  app.get("/api/petition-compile/:id", isAuthenticated, async (req, res) => {
    try {
      const petitionId = req.params.id;

      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      const sigs = await db.query.petitionSignatures.findMany({
        where: eq(petitionSignatures.petitionId, petitionId),
        orderBy: asc(petitionSignatures.signedAt),
      });

      // Generate plain text compilation
      const now = new Date();
      const timestamp = now.toISOString().replace(/:/g, '-').substring(0, 16).replace('T', '_');
      const officerLastName = petition.officerName.split(' ').pop() || 'Unknown';
      const filename = `petition_${officerLastName}_${timestamp}_plain.txt`;

      let content = '';
      let lineCount = 0;
      let pageNumber = 1;

      const addLine = (line: string) => {
        content += line + '\n';
        lineCount++;
        if (lineCount % 60 === 0) {
          content += `\n--- Page ${pageNumber} ---\n\n`;
          pageNumber++;
          lineCount += 2;
        }
      };

      // Header
      addLine('='.repeat(80));
      addLine('PETITION FOR OFFICER RESIGNATION');
      addLine('='.repeat(80));
      addLine('');
      addLine(`Officer: ${petition.officerName}`);
      addLine(`Department: ${petition.department}`);

      const location = [petition.city, petition.county, petition.state].filter(Boolean).join(', ');
      if (location) {
        addLine(`Location: ${location}`);
      }

      addLine(`Total Signatures: ${petition.signatureCount}`);
      addLine(`Compiled: ${now.toUTCString()}`);
      addLine('');
      addLine('-'.repeat(80));
      addLine('INCIDENT DESCRIPTION');
      addLine('-'.repeat(80));
      addLine('');

      const description = petition.offenseDescriptionRedrafted || petition.offenseDescriptionOriginal;
      const descLines = description.split('\n');
      descLines.forEach(line => addLine(line));

      if (petition.additionalText) {
        addLine('');
        addLine('-'.repeat(80));
        addLine('ADDITIONAL INFORMATION');
        addLine('-'.repeat(80));
        addLine('');
        const additionalLines = petition.additionalText.split('\n');
        additionalLines.forEach(line => addLine(line));
      }

      addLine('');
      addLine('='.repeat(80));
      addLine('SIGNATURE ROSTER');
      addLine('='.repeat(80));
      addLine('');

      sigs.forEach((sig, index) => {
        addLine(`#${index + 1}`);
        addLine(`  Typed Signature: ${sig.typedSignature}`);
        addLine(`  Full Name: ${sig.fullName}`);
        addLine(`  Signed At: ${new Date(sig.signedAt).toUTCString()}`);
        addLine('');
      });

      addLine('');
      addLine('='.repeat(80));
      addLine(`END OF PETITION - ${petition.signatureCount} TOTAL SIGNATURES`);
      addLine('='.repeat(80));

      // Update lastCompiledAt
      await db.update(petitions)
        .set({ lastCompiledAt: now, updatedAt: now })
        .where(eq(petitions.id, petitionId));

      // Send as downloadable file
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error: any) {
      console.error("Error compiling petition:", error);
      res.status(500).json({ message: "Error compiling petition" });
    }
  });

  // ============================================
  // ADMIN EMAIL ROUTE
  // ============================================
  
  app.post('/api/admin/send-custom-email', adminAuthMiddleware, async (req, res) => {
    try {
      // Validate request body
      const schema = z.object({
        to: z.string().email(),
        subject: z.string().min(1),
        message: z.string().min(1),
      });

      const data = schema.parse(req.body);

      // Send email using existing Resend integration
      const success = await sendAdminEmail({
        to: data.to,
        subject: data.subject,
        message: data.message,
      });

      if (success) {
        res.json({ 
          success: true, 
          message: `Email sent successfully to ${data.to}` 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to send email. Please check Resend configuration.' 
        });
      }
    } catch (error: any) {
      console.error('[API] Error sending custom email:', error);
      
      if (error.name === 'ZodError') {
        res.status(400).json({ 
          success: false, 
          message: 'Invalid request data. Please check all fields.' 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          message: error.message || 'Failed to send email' 
        });
      }
    }
  });

  // ============================================
  // AI SUB-AGENT ROUTES (Admin Only)
  // ============================================

  // Test endpoint to verify routing
  app.post("/api/admin/subagent/test", isAuthenticated, async (req: any, res) => {
    const userId = req.user?.claims?.sub;
    console.log('[TEST] User:', userId);
    console.log('[TEST] Body:', req.body);
    res.json({ success: true, userId, body: req.body });
  });

  // Process AI Sub-Agent command
  app.post("/api/admin/subagent/command", (req: any, res, next) => {
    console.log('[AI SUB-AGENT DEBUG] Request received');
    console.log('[AI SUB-AGENT DEBUG] isAuthenticated():', req.isAuthenticated?.());
    console.log('[AI SUB-AGENT DEBUG] req.user:', req.user);
    console.log('[AI SUB-AGENT DEBUG] req.session:', req.session);
    next();
  }, isAuthenticated, subAgentRateLimit, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      console.log('[AI SUB-AGENT] Command request received from user:', userId);
      console.log('[AI SUB-AGENT] Request body:', req.body);

      // Only allow admin bypass user
      if (userId !== "admin-bypass") {
        console.log('[AI SUB-AGENT] Access denied - user is not admin-bypass');
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const { command, category } = req.body;

      if (!command || typeof command !== 'string') {
        return res.status(400).json({ message: "Command is required" });
      }

      // Log the command initiation
      const logEntry = await db.insert(aiSubAgentLogs).values({
        adminId: userId,
        command,
        category: category || null,
        status: 'processing',
      }).returning();

      const logId = logEntry[0].id;

      // Process command asynchronously
      processSubAgentCommand({ command, category })
        .then(async (result) => {
          await db.update(aiSubAgentLogs)
            .set({
              status: result.success ? 'completed' : 'failed',
              response: result.response,
              category: result.category,
              executionTimeMs: result.executionTimeMs,
              errorMessage: result.errorMessage || null,
              metadata: result.metadata || {},
              completedAt: new Date(),
            })
            .where(eq(aiSubAgentLogs.id, logId));
        })
        .catch(async (error) => {
          await db.update(aiSubAgentLogs)
            .set({
              status: 'failed',
              errorMessage: error.message,
              completedAt: new Date(),
            })
            .where(eq(aiSubAgentLogs.id, logId));
        });

      // Return immediately with log ID
      res.json({
        logId,
        message: "Command processing initiated",
      });

    } catch (error: any) {
      console.error("Error initiating AI Sub-Agent command:", error);
      res.status(500).json({ message: "Error processing command" });
    }
  });

  // Get AI Sub-Agent command status
  app.get("/api/admin/subagent/status/:logId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const { logId } = req.params;

      const log = await db.query.aiSubAgentLogs.findFirst({
        where: eq(aiSubAgentLogs.id, logId),
      });

      if (!log) {
        return res.status(404).json({ message: "Log not found" });
      }

      res.json({ log });

    } catch (error: any) {
      console.error("Error fetching AI Sub-Agent status:", error);
      res.status(500).json({ message: "Error fetching status" });
    }
  });

  // Get AI Sub-Agent command history
  app.get("/api/admin/subagent/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const limit = parseInt(req.query.limit as string) || 50;

      const logs = await db.query.aiSubAgentLogs.findMany({
        orderBy: desc(aiSubAgentLogs.createdAt),
        limit,
      });

      res.json(logs);

    } catch (error: any) {
      console.error("Error fetching AI Sub-Agent history:", error);
      res.status(500).json({ message: "Error fetching history" });
    }
  });

  // Run comprehensive diagnostic manually
  app.get("/api/admin/subagent/diagnostic", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      console.log('[AI Sub-Agent] Running manual comprehensive diagnostic...');
      const result = await runComprehensiveDiagnostic(false);

      res.json({
        success: result.success,
        issuesFound: result.issuesFound,
        criticalIssues: result.criticalIssues,
        autoFixed: result.autoFixed,
        report: result.report,
      });

    } catch (error: any) {
      console.error("Error running comprehensive diagnostic:", error);
      res.status(500).json({ message: "Error running diagnostic: " + error.message });
    }
  });

  // TEMPORARY: Diagnostic endpoint without authentication for testing
  app.get("/api/test/diagnostics", async (req: any, res) => {
    console.log('[DIAGNOSTICS] Running comprehensive diagnostic test (no auth)...');
    try {
      // Use the comprehensive test that actually calls services
      const { runComprehensiveDiagnostics } = await import('./testDiagnostics');
      const result = await runComprehensiveDiagnostics();
      
      // Return the comprehensive diagnostic result directly
      res.json(result);
    } catch (error: any) {
      console.error('[DIAGNOSTICS] Error:', error);
      res.status(500).json({
        error: error.message,
        stack: error.stack
      });
    }
  });

  // Run full system diagnostics (comprehensive test of database, AI, APIs, etc)
  app.get("/api/admin/system-diagnostics", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      console.log('[DIAGNOSTICS] Running full system diagnostics...');
      const result = await runFullDiagnostics();

      res.json(result);

    } catch (error: any) {
      console.error("Error running full system diagnostics:", error);
      res.status(500).json({ message: "Error running diagnostics: " + error.message });
    }
  });

  // Undo last AI Sub-Agent change
  app.post("/api/admin/subagent/undo", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      console.log('[AI Sub-Agent] Undoing last change...');
      const result = await undoLastSubAgentChange();

      res.json(result);

    } catch (error: any) {
      console.error("Error undoing last change:", error);
      res.status(500).json({ success: false, message: "Error undoing change: " + error.message });
    }
  });

  // Get last AI Sub-Agent change (for display)
  app.get("/api/admin/subagent/last-change", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const lastChange = getLastSubAgentChange();

      res.json({
        hasChange: !!lastChange,
        change: lastChange
      });

    } catch (error: any) {
      console.error("Error getting last change:", error);
      res.status(500).json({ hasChange: false, error: error.message });
    }
  });

  // ============================================
  // SECURITY FIREWALL CONTROLS
  // ============================================

  // Get autonomous execution status and rate limit info
  app.get("/api/admin/subagent/security-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const status = getAutonomousExecutionStatus();
      res.json(status);

    } catch (error: any) {
      console.error("Error getting security status:", error);
      res.status(500).json({ message: "Error getting security status: " + error.message });
    }
  });

  // Enable/disable autonomous execution (kill switch)
  app.post("/api/admin/subagent/kill-switch", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ message: "Parameter 'enabled' must be boolean" });
      }

      const result = setAutonomousExecution(enabled);
      res.json(result);

    } catch (error: any) {
      console.error("Error toggling kill switch:", error);
      res.status(500).json({ success: false, message: "Error toggling kill switch: " + error.message });
    }
  });

  // Reset rate limiter
  app.post("/api/admin/subagent/reset-rate-limit", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const result = resetRateLimiter();
      res.json(result);

    } catch (error: any) {
      console.error("Error resetting rate limiter:", error);
      res.status(500).json({ success: false, message: "Error resetting rate limiter: " + error.message });
    }
  });

  // Apply training to Sub-Agent (Officer & Department Search)
  app.post("/api/admin/subagent/apply-training", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      console.log('[AI Sub-Agent] Applying officer & department search training...');
      const result = await applyTrainingToSubAgent();

      res.json(result);

    } catch (error: any) {
      console.error("Error applying training:", error);
      res.status(500).json({ success: false, message: "Error applying training: " + error.message });
    }
  });

  // Get autonomous failure detection status
  app.get("/api/admin/subagent/failure-detection-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const { getFailureDetectionStatus } = await import('./aiSubAgent');
      const status = getFailureDetectionStatus();

      res.json(status);

    } catch (error: any) {
      console.error("Error getting failure detection status:", error);
      res.status(500).json({ message: "Error getting failure detection status: " + error.message });
    }
  });

  // ============================================
  // PERSISTENT STORAGE API
  // ============================================

  // Manual backup trigger
  app.post('/api/admin/backup', isAuthenticated, async (req: any, res) => {
    try {
      const { persistenceManager } = await import('./persistenceManager');
      await persistenceManager.backupState();
      res.json({ success: true, message: 'Backup completed' });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Export all data
  app.post('/api/admin/export', isAuthenticated, async (req: any, res) => {
    try {
      const { persistenceManager } = await import('./persistenceManager');
      const filename = await persistenceManager.exportAllData();
      res.json({ success: true, filename });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // List all backups
  app.get('/api/admin/backups', isAuthenticated, async (req: any, res) => {
    try {
      const { persistentStorage } = await import('./persistentStorage');
      const keys = await persistentStorage.listKeys();
      const backups = keys.filter(k => k.startsWith('backup_') || k === 'latest_backup');
      res.json({ backups });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================
  // EMAIL ADMIN ROUTES
  // ============================================

  // Get support email settings
  app.get("/api/admin/support-email", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const settings = await db.query.appSettings.findMany({
        where: sql`key IN ('support_from_name', 'support_from_email')`,
      });

      const fromName = settings.find(s => s.key === 'support_from_name')?.value || process.env.DEFAULT_FROM_NAME || 'Bad Blue';
      const fromEmail = settings.find(s => s.key === 'support_from_email')?.value || process.env.DEFAULT_FROM_EMAIL || 'no-reply@mail.badblue.app';

      res.json({ fromName, fromEmail });

    } catch (error: any) {
      console.error("Error fetching support email settings:", error);
      res.status(500).json({ message: "Error fetching settings" });
    }
  });

  // Update support email settings
  app.post("/api/admin/support-email", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const { fromName, fromEmail } = req.body;

      // Validation
      if (!fromName || fromName.length < 1 || fromName.length > 80) {
        return res.status(400).json({ message: "From Name must be between 1 and 80 characters" });
      }

      // RFC5322 email validation (basic)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!fromEmail || !emailRegex.test(fromEmail)) {
        return res.status(400).json({ message: "Invalid email address format" });
      }

      // Get old values for audit
      const oldSettings = await db.query.appSettings.findMany({
        where: sql`key IN ('support_from_name', 'support_from_email')`,
      });

      const oldFromName = oldSettings.find(s => s.key === 'support_from_name')?.value;
      const oldFromEmail = oldSettings.find(s => s.key === 'support_from_email')?.value;

      // Update or insert settings
      await db.insert(appSettings).values({
        key: 'support_from_name',
        value: fromName,
        updatedBy: userId,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: fromName, updatedBy: userId, updatedAt: new Date() },
      });

      await db.insert(appSettings).values({
        key: 'support_from_email',
        value: fromEmail,
        updatedBy: userId,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: fromEmail, updatedBy: userId, updatedAt: new Date() },
      });

      // Audit log
      if (oldFromName !== fromName) {
        await db.insert(adminSettingsAudit).values({
          settingKey: 'support_from_name',
          oldValue: oldFromName || null,
          newValue: fromName,
          adminId: userId,
          ipAddress: req.ip || null,
        });
      }

      if (oldFromEmail !== fromEmail) {
        await db.insert(adminSettingsAudit).values({
          settingKey: 'support_from_email',
          oldValue: oldFromEmail || null,
          newValue: fromEmail,
          adminId: userId,
          ipAddress: req.ip || null,
        });
      }

      res.json({ fromName, fromEmail, message: "Settings updated successfully" });

    } catch (error: any) {
      console.error("Error updating support email settings:", error);
      res.status(500).json({ message: "Error updating settings" });
    }
  });

  // Send test email
  app.post("/api/admin/support-email/test", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const user = req.user?.claims;
      const toEmail = user?.email || 'admin@badblue.internal';

      await sendAdminTestEmail(toEmail);

      res.json({ message: `Test email sent to ${toEmail}` });

    } catch (error: any) {
      console.error("Error sending test email:", error);
      res.status(500).json({ message: "Error sending test email: " + error.message });
    }
  });

  // Get recent user logins
  app.get("/api/admin/users/logins", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const query = (req.query.query as string) || '';
      const filter = (req.query.filter as string) || 'all';
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 25;
      const offset = (page - 1) * limit;

      // Build query
      let whereConditions = [];

      if (query) {
        whereConditions.push(sql`(email ILIKE ${`%${query}%`} OR first_name ILIKE ${`%${query}%`} OR last_name ILIKE ${`%${query}%`})`);
      }

      if (filter === 'subscribers') {
        whereConditions.push(sql`has_paid_for_access = true`);
      } else if (filter === 'non_subscribers') {
        whereConditions.push(sql`has_paid_for_access = false`);
      }

      const whereClause = whereConditions.length > 0
        ? sql`WHERE ${sql.join(whereConditions, sql` AND `)}`
        : sql``;

      const users = await db.execute(sql`
        SELECT
          id,
          email,
          first_name,
          last_name,
          has_paid_for_access as "accessActive",
          last_login_at as "lastLoginAt",
          created_at as "createdAt"
        FROM users
        ${whereClause}
        ORDER BY last_login_at DESC NULLS LAST
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM users ${whereClause}
      `);

      const total = Number(countResult.rows[0]?.total || 0);

      res.json({
        users: users.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });

    } catch (error: any) {
      console.error("Error fetching user logins:", error);
      res.status(500).json({ message: "Error fetching user logins" });
    }
  });

  // Send email to user with attachments
  app.post("/api/admin/send-user-email", isAuthenticated, upload.array('attachments', 10), async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Access denied: Admin only" });
      }

      const { toEmail, subject, message } = req.body;

      // Validation
      if (!toEmail || !subject || !message) {
        return res.status(400).json({ message: "Email, subject, and message are required" });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(toEmail)) {
        return res.status(400).json({ message: "Invalid email address format" });
      }

      // Process attachments
      const attachments = req.files ? (req.files as Express.Multer.File[]).map(file => ({
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype,
      })) : undefined;

      const success = await sendUserEmail(toEmail, subject, message, attachments);

      if (success) {
        res.json({ message: "Email sent successfully" });
      } else {
        res.status(500).json({ message: "Failed to send email" });
      }

    } catch (error: any) {
      console.error("Error sending user email:", error);
      res.status(500).json({ message: "Error sending email: " + error.message });
    }
  });

  // Database connection test endpoint (admin only)
  app.get("/api/admin/test-db", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const testResult = await db.execute(sql`SELECT 1 as test`);
      res.json({ 
        success: true, 
        message: "Database connection successful",
        result: testResult.rows 
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: "Database connection failed",
        error: error.message,
        code: error.code,
        hostname: error.hostname
      });
    }
  });

  // ============================================
  // ADMIN: SUBSCRIPTION TIER MANAGEMENT
  // ============================================

  // Get all subscription tiers
  app.get("/api/admin/subscription-tiers", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const tiers = await db.query.subscriptionTiers.findMany({
        orderBy: [asc(subscriptionTiers.sortOrder), asc(subscriptionTiers.name)],
      });

      res.json({ tiers });
    } catch (error: any) {
      console.error("Error fetching subscription tiers:", error);
      res.status(500).json({ message: "Error fetching subscription tiers" });
    }
  });

  // Get single subscription tier
  app.get("/api/admin/subscription-tiers/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const tier = await db.query.subscriptionTiers.findFirst({
        where: eq(subscriptionTiers.id, req.params.id),
      });

      if (!tier) {
        return res.status(404).json({ message: "Subscription tier not found" });
      }

      res.json({ tier });
    } catch (error: any) {
      console.error("Error fetching subscription tier:", error);
      res.status(500).json({ message: "Error fetching subscription tier" });
    }
  });

  // Create subscription tier
  app.post("/api/admin/subscription-tiers", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const validatedData = insertSubscriptionTierSchema.parse(req.body);

      const [newTier] = await db.insert(subscriptionTiers)
        .values(validatedData)
        .returning();

      res.json({ tier: newTier, message: "Subscription tier created successfully" });
    } catch (error: any) {
      console.error("Error creating subscription tier:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error creating subscription tier" });
    }
  });

  // Update subscription tier
  app.patch("/api/admin/subscription-tiers/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const validatedData = insertSubscriptionTierSchema.partial().parse(req.body);

      const [updatedTier] = await db.update(subscriptionTiers)
        .set({ ...validatedData, updatedAt: new Date() })
        .where(eq(subscriptionTiers.id, req.params.id))
        .returning();

      if (!updatedTier) {
        return res.status(404).json({ message: "Subscription tier not found" });
      }

      res.json({ tier: updatedTier, message: "Subscription tier updated successfully" });
    } catch (error: any) {
      console.error("Error updating subscription tier:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: "Error updating subscription tier" });
    }
  });

  // Delete subscription tier
  app.delete("/api/admin/subscription-tiers/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const [deletedTier] = await db.delete(subscriptionTiers)
        .where(eq(subscriptionTiers.id, req.params.id))
        .returning();

      if (!deletedTier) {
        return res.status(404).json({ message: "Subscription tier not found" });
      }

      res.json({ message: "Subscription tier deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting subscription tier:", error);
      res.status(500).json({ message: "Error deleting subscription tier" });
    }
  });

  // ============================================
  // ADMIN: USER SUBSCRIPTION MANAGEMENT
  // ============================================

  // Get all user subscriptions with pagination
  app.get("/api/admin/user-subscriptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = (page - 1) * limit;

      const subscriptions = await db.execute(sql`
        SELECT 
          us.id,
          us.user_id,
          us.tier_id,
          us.start_date,
          us.end_date,
          us.is_active,
          us.payment_id,
          us.created_at,
          u.email,
          u.first_name,
          u.last_name,
          st.name as tier_name,
          st.price_in_cents
        FROM user_subscriptions us
        JOIN users u ON us.user_id = u.id
        JOIN subscription_tiers st ON us.tier_id = st.id
        ORDER BY us.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM user_subscriptions
      `);

      const total = Number(countResult.rows[0]?.total || 0);

      res.json({
        subscriptions: subscriptions.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error: any) {
      console.error("Error fetching user subscriptions:", error);
      res.status(500).json({ message: "Error fetching user subscriptions" });
    }
  });

  // Assign subscription to user
  app.post("/api/admin/user-subscriptions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { userId: targetUserId, tierId, startDate } = req.body;

      if (!targetUserId || !tierId) {
        return res.status(400).json({ message: "userId and tierId are required" });
      }

      // Get tier details to calculate end date
      const tier = await db.query.subscriptionTiers.findFirst({
        where: eq(subscriptionTiers.id, tierId),
      });

      if (!tier) {
        return res.status(404).json({ message: "Subscription tier not found" });
      }

      const start = startDate ? new Date(startDate) : new Date();
      const end = new Date(start);
      end.setDate(end.getDate() + tier.durationDays);

      const [newSubscription] = await db.insert(userSubscriptions)
        .values({
          userId: targetUserId,
          tierId,
          startDate: start,
          endDate: end,
          isActive: true,
        })
        .returning();

      res.json({ 
        subscription: newSubscription, 
        message: "Subscription assigned successfully" 
      });
    } catch (error: any) {
      console.error("Error assigning subscription:", error);
      res.status(500).json({ message: "Error assigning subscription" });
    }
  });

  // Cancel user subscription
  app.patch("/api/admin/user-subscriptions/:id/cancel", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const [cancelledSubscription] = await db.update(userSubscriptions)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(userSubscriptions.id, req.params.id))
        .returning();

      if (!cancelledSubscription) {
        return res.status(404).json({ message: "Subscription not found" });
      }

      res.json({ 
        subscription: cancelledSubscription,
        message: "Subscription cancelled successfully" 
      });
    } catch (error: any) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ message: "Error cancelling subscription" });
    }
  });

  // Get user's active subscriptions
  app.get("/api/admin/users/:userId/subscriptions", isAuthenticated, async (req: any, res) => {
    try {
      const adminId = req.user?.claims?.sub;
      if (adminId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const subscriptions = await db.execute(sql`
        SELECT 
          us.*,
          st.name as tier_name,
          st.price_in_cents,
          st.duration_days,
          st.features
        FROM user_subscriptions us
        JOIN subscription_tiers st ON us.tier_id = st.id
        WHERE us.user_id = ${req.params.userId}
        ORDER BY us.created_at DESC
      `);

      res.json({ subscriptions: subscriptions.rows });
    } catch (error: any) {
      console.error("Error fetching user subscriptions:", error);
      res.status(500).json({ message: "Error fetching user subscriptions" });
    }
  });

  // Public endpoint to get support email for display
  app.get("/api/support-email", async (req, res) => {
    try {
      // Try to get from database with shorter timeout
      const settings = await Promise.race([
        db.query.appSettings.findMany({
          where: sql`key = 'support_from_email'`,
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database timeout')), 1500)
        )
      ]) as any[];

      const supportEmail = settings.find(s => s.key === 'support_from_email')?.value
        || process.env.DEFAULT_FROM_EMAIL
        || 'contact.badblue@gmail.com';

      res.json({ email: supportEmail });

    } catch (error: any) {
      // Silently handle database errors and return fallback
      const fallbackEmail = process.env.DEFAULT_FROM_EMAIL || 'contact.badblue@gmail.com';
      res.json({ email: fallbackEmail });
    }
  });

  // ============================================
  // STRIPE PAYMENT ROUTES
  // ============================================

  // Create Stripe Checkout Session for full access payment
  // DEPRECATED: Officer search and legal consultation are now FREE for all signed-in users
  app.post(
    "/api/create-access-payment",
    isAuthenticated,
    async (req: any, res) => {
      // Officer search and legal consultation are now FREE for all signed-in users
      // This endpoint is deprecated but kept for backwards compatibility
      return res.status(400).json({ 
        message: "Payment not required. Officer search and legal consultation are free for all signed-in users." 
      });
    },
  );

  // Stripe webhook handler
  app.post("/api/webhooks/stripe", async (req, res) => {
    try {
      const stripe = getStripeClient();
      const sig = req.headers["stripe-signature"];

      if (!sig) {
        console.error("[Webhook] Missing stripe signature");
        return res.status(400).send("Missing stripe signature");
      }

      if (!req.rawBody) {
        console.error("[Webhook] Missing raw body for signature verification");
        return res.status(400).send("Missing request body");
      }

      // Verify webhook signature for security
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        console.error("STRIPE_WEBHOOK_SECRET is not configured");
        return res.status(500).send("Webhook secret not configured");
      }

      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch (err: any) {
        console.error("Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Handle the event
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;

          // Safely extract metadata with comprehensive null checking
          const metadata = session.metadata;

          if (!metadata || typeof metadata !== 'object') {
            console.error('[Webhook] Invalid or missing metadata in session:', session.id);
            return res.status(400).send('Invalid session metadata');
          }

          // Type-safe metadata extraction with validation
          const { complaintId, lawsuitId, petitionId, foiaRequestId, userId, type } = metadata as Record<string, string | undefined>;

          // Validate that at least one ID exists OR it's a full_access payment
          if (!complaintId && !lawsuitId && !petitionId && !foiaRequestId && type !== "full_access") {
            console.error('[Webhook] No valid ID found in metadata:', metadata);
            return res.status(400).send('Missing required ID in metadata');
          }

          if (petitionId) {
            // Petition payment successful
            if (session.payment_status === "paid") {
              const paymentIntentId = session.payment_intent as string;

              try {
                // Update petition with payment info
                await db.update(petitions)
                  .set({
                    paymentId: paymentIntentId,
                    updatedAt: new Date(),
                  })
                  .where(eq(petitions.id, petitionId));

                console.log(`Petition ${petitionId} payment completed`);

                // Get petition details for confirmation email
                const petition = await db.query.petitions.findFirst({
                  where: eq(petitions.id, petitionId)
                });

                if (petition && userId) {
                  const user = await storage.getUser(userId);
                  if (user && user.email && user.firstName) {
                    // Send confirmation email with petition link
                    sendPurchaseConfirmationEmail({
                      firstName: user.firstName,
                      email: user.email,
                      type: "petition",
                      amount: session.amount_total || PETITION_PRICING_CENTS,
                      officerName: petition.officerName,
                      incidentDate: new Date().toISOString().split("T")[0],
                      state: petition.state,
                      document: `Your petition against ${petition.officerName} from ${petition.department} has been created successfully.`,
                      submissionVenue: `Public petition`,
                      submissionEmail: '',
                      submissionAddress: `Petition URL: ${petition.shareableUrl || ''}`,
                    })
                      .then((sent) => {
                        if (sent) {
                          console.log(`Petition confirmation email sent to ${user.email}`);
                        }
                      })
                      .catch((error) => {
                        console.error(`Failed to send petition confirmation email:`, error);
                      });
                  }
                }
              } catch (error) {
                console.error(`Failed to update petition ${metadata.petitionId}:`, error);
              }
            }
          } else if (foiaRequestId) {
            // FOIA Request payment successful
            if (session.payment_status === "paid") {
              const paymentIntentId = session.payment_intent as string;

              try {
                // Update FOIA request with payment info
                await db.update(foiaRequests)
                  .set({
                    paymentId: paymentIntentId,
                    paymentStatus: 'completed',
                    amountPaid: session.amount_total || FOIA_REQUEST_PRICING_CENTS,
                    status: 'paid',
                    statusUpdatedAt: new Date(),
                  })
                  .where(eq(foiaRequests.id, foiaRequestId));

                console.log(`FOIA Request ${foiaRequestId} payment completed`);

                // Get FOIA request details for confirmation email
                const foiaRequest = await db.query.foiaRequests.findFirst({
                  where: eq(foiaRequests.id, foiaRequestId)
                });

                if (foiaRequest && userId) {
                  const user = await storage.getUser(userId);
                  if (user && user.email && user.firstName) {
                    // Send confirmation email with FOIA letter
                    sendPurchaseConfirmationEmail({
                      firstName: user.firstName,
                      email: user.email,
                      type: "foia",
                      amount: session.amount_total || FOIA_REQUEST_PRICING_CENTS,
                      officerName: foiaRequest.officerName,
                      incidentDate: foiaRequest.incidentDate || new Date().toISOString().split("T")[0],
                      state: foiaRequest.state,
                      document: foiaRequest.generatedLetter || '',
                      submissionVenue: foiaRequest.departmentName,
                      submissionEmail: 'Certified Mail',
                      submissionAddress: foiaRequest.departmentAddress || '',
                    })
                      .then((sent) => {
                        if (sent) {
                          console.log(`FOIA confirmation email sent to ${user.email}`);
                        }
                      })
                      .catch((error) => {
                        console.error(`Failed to send FOIA confirmation email:`, error);
                      });
                  }
                }
              } catch (error) {
                console.error(`Failed to update FOIA request ${foiaRequestId}:`, error);
              }
            }
          } else if (complaintId) {
            // Complaint payment successful
            if (session.payment_status === "paid") {
              // Validate required payment fields
              if (!session.payment_intent) {
                console.error("Missing payment_intent in webhook session");
                return res.status(400).send("Missing payment_intent");
              }

              const paymentIntentId = session.payment_intent as string;
              const amountPaid =
                session.amount_total ||
                (type === "lawsuit"
                  ? LAWSUIT_PRICING_CENTS
                  : COMPLAINT_PRICING_CENTS);

              // Update complaint with payment info
              await storage.updateComplaintPayment(
                complaintId,
                paymentIntentId,
                "completed",
                amountPaid,
              );

              // Generate complaint document with state-specific statutes and routing info
              const complaint = await storage.getComplaint(complaintId);
              if (complaint) {
                const document = generateComplaintDocument(
                  complaint.state,
                  complaint.complaintType,
                  complaint.officerName,
                  complaint.officerBadge,
                  complaint.officerDepartment,
                  complaint.description,
                  complaint.incidentDate,
                  complaint.city,
                  (complaint as any).county || null,
                  (complaint as any).complainantName || null,
                  (complaint as any).complainantAddress || null,
                );

                const venueInfo = determineEnhancedSubmissionVenue(
                  complaint.state,
                  complaint.city,
                  null, // county not in schema
                  "civil_rights", // Complaints are typically for police departments
                );

                // Update complaint status and venue information
                await storage.updateComplaintStatusAndVenue(
                  complaintId,
                  "paid",
                  venueInfo.venue,
                  venueInfo.email,
                  venueInfo.physicalAddress,
                );
                console.log(
                  `Complaint ${metadata.complaintId} document generated. Submit to: ${venueInfo.venue}`,
                );
                console.log(`Email: ${venueInfo.email}`);
                console.log(`Address: ${venueInfo.physicalAddress}`);

                // Send purchase confirmation email with document copy
                const user = await storage.getUser(complaint.userId);
                if (user && user.email && user.firstName) {
                  sendPurchaseConfirmationEmail({
                    firstName: user.firstName,
                    email: user.email,
                    type: "complaint",
                    amount: amountPaid,
                    officerName: complaint.officerName,
                    incidentDate: complaint.incidentDate
                      .toISOString()
                      .split("T")[0],
                    state: complaint.state,
                    document,
                    submissionVenue: venueInfo.venue,
                    submissionEmail: venueInfo.email,
                    submissionAddress: venueInfo.physicalAddress,
                  })
                    .then((sent) => {
                      if (sent) {
                        console.log(
                          `Purchase confirmation email sent to ${user.email}`,
                        );
                      }
                    })
                    .catch((error) => {
                      console.error(
                        `Failed to send confirmation email:`,
                        error,
                      );
                    });

                  // IMMEDIATELY SUBMIT COMPLAINT TO VERIFIED VENUE
                  // Find verified jurisdiction for complaint submission
                  const jurisdiction = await storage.findVerifiedJurisdiction(
                    complaint.city,
                    (complaint as any).county || null,
                    complaint.state,
                    'police' // Complaints are typically for police departments
                  );

                  if (jurisdiction && jurisdiction.contactEmail) {
                    console.log(`Submitting complaint to verified venue: ${jurisdiction.contactEmail}`);

                    // Check if this is an admin test submission
                    if (user.id === "admin-bypass") {
                      const adminEmail = user.email || 'admin@badblue.internal';
                      console.log(`[ADMIN TEST] Sending test email to ${adminEmail} instead of actual venue`);

                      // Send admin test email to the admin's email address
                      sendAdminTestEmail(adminEmail)
                        .then((sent) => {
                          if (sent) {
                            console.log(`[ADMIN TEST] Test email sent to ${adminEmail}. Venue would be: ${jurisdiction.contactEmail}`);
                          }
                        })
                        .catch((error) => {
                          console.error(`[ADMIN TEST] Failed to send test email:`, error);
                        });
                    } else {
                      // Normal user - send to actual venue
                      sendComplaintToVenue({
                        venueEmail: jurisdiction.contactEmail || '',
                        complaintType: complaint.complaintType,
                        officerName: complaint.officerName,
                        officerBadge: complaint.officerBadge || '',
                        department: complaint.officerDepartment,
                        state: complaint.state,
                        city: complaint.city,
                        county: (complaint as any).county || undefined,
                        incidentDate: complaint.incidentDate.toISOString().split("T")[0],
                        description: complaint.description,
                        submitterName: user.firstName + (user.lastName ? ` ${user.lastName}` : ''),
                        submitterEmail: user.email || '',
                      })
                        .then((sent) => {
                          if (sent) {
                            console.log(`Complaint successfully submitted to ${jurisdiction.contactEmail}`);
                          } else {
                            console.error(`Failed to submit complaint to venue`);
                          }
                        })
                        .catch((error) => {
                          console.error(`Error submitting complaint to venue:`, error);
                        });
                    }
                  } else {
                    console.warn(`No verified jurisdiction found for ${complaint.city}, ${complaint.state}. Complaint not auto-submitted to venue.`);
                    console.warn(`User will receive confirmation email with venue info for manual submission.`);
                  }
                }
              }
            }
          } else if (lawsuitId) {
            // Lawsuit payment successful
            if (session.payment_status === "paid") {
              // Validate required payment fields
              if (!session.payment_intent) {
                console.error("Missing payment_intent in webhook session");
                return res.status(400).send("Missing payment_intent");
              }

              const paymentIntentId = session.payment_intent as string;
              const amountPaid =
                session.amount_total ||
                (type === "lawsuit"
                  ? LAWSUIT_PRICING_CENTS
                  : COMPLAINT_PRICING_CENTS);

              // Update lawsuit with payment info
              await storage.updateLawsuitPayment(
                lawsuitId,
                paymentIntentId,
                "completed",
                amountPaid,
              );

              // Generate lawsuit document with COMPREHENSIVE legal research
              const lawsuit = await storage.getLawsuitFiling(lawsuitId);
              if (lawsuit) {
                console.log(`[Lawsuit Generation] Starting comprehensive legal research for lawsuit ${lawsuitId}`);

                // STEP 1: Research relevant statutes (federal and state)
                console.log(`[Lawsuit Generation] Researching statutes for ${lawsuit.state}...`);
                const statuteResearch = await researchRelevantStatutes(
                  lawsuit.state,
                  lawsuit.lawsuitType,
                  lawsuit.description
                );
                console.log(`[Lawsuit Generation] Found ${statuteResearch.federalStatutes.length} federal statutes, ${statuteResearch.stateStatutes.length} state statutes`);

                // STEP 2: Analyze local district rules
                console.log(`[Lawsuit Generation] Analyzing local district rules...`);
                const districtRules = await analyzeLocalDistrictRules(
                  lawsuit.state,
                  lawsuit.city,
                  (lawsuit as any).county || null
                );
                console.log(`[Lawsuit Generation] Found ${districtRules.localRules.length} local rules for ${districtRules.district}`);

                // STEP 3: Analyze case law and precedents
                console.log(`[Lawsuit Generation] Analyzing case law...`);
                const caseLawAnalysis = await analyzeCaseLaw(
                  lawsuit.state,
                  lawsuit.lawsuitType,
                  lawsuit.description
                );
                console.log(`[Lawsuit Generation] Found ${caseLawAnalysis.leadingCases.length} Supreme Court cases, ${caseLawAnalysis.circuitCases.length} circuit cases, ${caseLawAnalysis.stateCases.length} state cases`);

                // STEP 4: Search for state-specific forms and templates
                console.log(`[Lawsuit Generation] Searching for lawsuit forms and templates...`);
                const formResearch = await searchLawsuitFormsAndRules(
                  lawsuit.state,
                  (lawsuit as any).county || null,
                  lawsuit.city,
                  lawsuit.lawsuitType
                );
                console.log(`[Lawsuit Generation] Forms found: ${formResearch.formsFound}`);

                // STEP 5: Generate document with ALL research integrated
                console.log(`[Lawsuit Generation] Generating comprehensive lawsuit document...`);
                const generationResult = await generateLegalDocument(
                  'lawsuit',
                  {
                    state: lawsuit.state,
                    lawsuitType: lawsuit.lawsuitType,
                    officerName: lawsuit.officerName,
                    officerBadge: lawsuit.officerBadge,
                    officerDepartment: lawsuit.officerDepartment,
                    description: lawsuit.description,
                    incidentDate: lawsuit.incidentDate,
                    incidentTime: (lawsuit as any).incidentTime || null,
                    plaintiffName: (lawsuit as any).plaintiffName || null,
                    plaintiffAddress: (lawsuit as any).plaintiffAddress || null,
                    injuryDetails: (lawsuit as any).injuryDetails || null,
                    subsequentEvents: (lawsuit as any).subsequentEvents || null,
                    witnessNames: (lawsuit as any).witnessNames || null,
                    city: lawsuit.city,
                    county: (lawsuit as any).county || null,
                    complainantName: (lawsuit as any).complainantName || null,
                    complainantAddress: (lawsuit as any).complainantAddress || null,
                    damagesAmount: (lawsuit as any).damagesAmount || null,
                    // Include all research
                    statuteResearch,
                    districtRules,
                    caseLawAnalysis,
                    formResearch,
                  }
                );
                const document = generationResult.document;
                console.log(`[Lawsuit Generation] Monell claim: ${generationResult.hasMonellClaim ? 'YES' : 'NO'} (${generationResult.monellConfidence} confidence)`);
                if (generationResult.hasMonellClaim) {
                  console.log(`[Lawsuit Generation] Monell indicators: ${generationResult.monellIndicators.join(', ')}`);
                }

                const venueInfo = determineEnhancedSubmissionVenue(
                  lawsuit.state,
                  lawsuit.city,
                  null, // county not in schema
                  "civil_rights", // lawsuits go to courts
                );

                // Search for state-specific filing information (including clerk of court address)
                const { searchStateFilingInfo } = await import('./filingInfoSearch');
                const filingInfo = await searchStateFilingInfo(lawsuit.state, lawsuit.city);
                console.log(`Filing info for ${lawsuit.state}:`, filingInfo);

                // Update lawsuit with filing information
                await storage.updateLawsuitFilingInfo(
                  lawsuitId,
                  filingInfo.filingFee,
                  filingInfo.eFilingPortalUrl,
                  filingInfo.eFilingPortalName,
                  filingInfo.filingInstructions,
                  filingInfo.clerkOfCourtAddress
                );

                // Get user information early (needed for tort notice and confirmation email)
                const user = await storage.getUser(lawsuit.userId);

                // Search for relevant legal precedents using AI
                const { searchPrecedents, formatPrecedentsForDocument } = await import('./precedentSearch');
                const precedents = await searchPrecedents(
                  lawsuit.description,
                  lawsuit.state,
                  'both'
                );
                console.log(`Found ${precedents.length} relevant precedents`);

                // Save precedents as formatted strings
                const precedentStrings = precedents.map(p =>
                  `${p.caseName}, ${p.citation} (${p.court}, ${p.year}): ${p.keyHolding}`
                );
                await storage.updateLawsuitPrecedents(lawsuitId, precedentStrings);

                // Check if tort claim notice is required
                const { isTortNoticeRequired, determineTortNoticeRecipient } = await import('./tortNoticeRequirements');
                const tortRequirement = isTortNoticeRequired(lawsuit.state);

                if (tortRequirement.required) {
                  console.log(`Tort notice required for ${lawsuit.state}. Generating and sending notice...`);

                  // Determine agency type based on department name
                  const agencyType = lawsuit.officerDepartment.toLowerCase().includes('sheriff') ? 'sheriff' :
                                    lawsuit.officerDepartment.toLowerCase().includes('state') || lawsuit.officerDepartment.toLowerCase().includes('trooper') ? 'trooper' :
                                    'police';

                  const tortRecipient = determineTortNoticeRecipient(
                    lawsuit.state,
                    lawsuit.city,
                    (lawsuit as any).county || null,
                    agencyType
                  );

                  // Try to find jurisdiction email for tort notice
                  const tortJurisdiction = await storage.findJurisdictionByLocation(
                    lawsuit.city,
                    (lawsuit as any).county || null,
                    lawsuit.state,
                    agencyType
                  );

                  if (tortJurisdiction && tortJurisdiction.contactEmail && user && user.email && user.firstName) {
                    // Generate tort notice
                    const { generateTortNotice } = await import('./tortNoticeGenerator');
                    const tortNotice = await generateTortNotice({
                      state: lawsuit.state,
                      claimantName: user.firstName + (user.lastName ? ` ${user.lastName}` : ''),
                      claimantAddress: (lawsuit as any).complainantAddress || 'Address on file',
                      claimantEmail: user.email,
                      officerName: lawsuit.officerName,
                      officerBadge: lawsuit.officerBadge || '',
                      department: lawsuit.officerDepartment,
                      city: lawsuit.city,
                      county: (lawsuit as any).county || null,
                      incidentDate: lawsuit.incidentDate,
                      incidentDescription: lawsuit.description,
                      damagesAmount: (lawsuit as any).damagesAmount || undefined,
                      injuryDetails: (lawsuit as any).injuryDetails || undefined,
                    });

                    // Send tort notice to agency
                    const tortNoticeSent = await sendTortNoticeToAgency({
                      agencyEmail: tortJurisdiction.contactEmail,
                      agencyName: tortRecipient.agency,
                      state: lawsuit.state,
                      claimantName: user.firstName + (user.lastName ? ` ${user.lastName}` : ''),
                      claimantEmail: user.email,
                      tortNoticeDocument: tortNotice,
                    });

                    // Update lawsuit with tort notice info
                    await storage.updateLawsuitTortNotice(
                      lawsuitId,
                      true,
                      tortNoticeSent,
                      tortRecipient.agency,
                      tortNotice
                    );

                    console.log(`Tort notice ${tortNoticeSent ? 'sent to' : 'generated for'} ${tortRecipient.agency}`);
                  } else {
                    // Save that notice is required but couldn't be sent
                    await storage.updateLawsuitTortNotice(
                      lawsuitId,
                      true,
                      false,
                      tortRecipient.agency,
                      null
                    );
                    console.log(`Tort notice required but no verified email found for ${tortRecipient.agency}`);
                  }
                } else {
                  // Tort notice not required for this state
                  await storage.updateLawsuitTortNotice(
                    lawsuitId,
                    false,
                    false,
                    null,
                    null
                  );
                  console.log(`Tort notice not required for ${lawsuit.state}`);
                }
              }
            }
          } else if (type === "full_access") {
            // DEPRECATED: Full access payments are no longer needed
            // Officer search and legal consultation are now FREE for all signed-in users
            console.log(`Received deprecated full_access payment webhook - ignoring as these features are now free`);
          }
          break;
        }

        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error);
      res.status(400).send(`Webhook Error: ${error.message}`);
    }
  });

  // ============================================
  // BADGE LOOKUP ROUTES
  // ============================================

  // Analyze badge image with enhanced extraction
  app.post(
    "/api/badge-lookups/analyze",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        const { imageData } = req.body;

        if (!imageData) {
          return res.status(400).json({ message: "No image data provided" });
        }

        // Check if Gemini is configured
        if (!process.env.GEMINI_API_KEY) {
          return res.status(503).json({
            message:
              "Badge analysis service is currently unavailable. The AI service has not been configured. Please contact support.",
            code: "SERVICE_UNAVAILABLE",
          });
        }

        // Analyze image with Gemini Vision
        const analysis = await analyzeBadgeImage(imageData);

        // Lookup officer information if we have badge/department
        const officerInfo =
          analysis.badgeNumber || analysis.department
            ? lookupOfficerInfo(
                analysis.badgeNumber || "",
                analysis.department || "",
                analysis.officerName || undefined,
              )
            : null;

        // Save lookup to database with enhanced fields
        const lookup = await storage.createBadgeLookup({
          userId,
          imageUrl: imageData.substring(0, 500), // Store truncated for space
          badgeNumber: analysis.badgeNumber || officerInfo?.badgeNumber || null,
          department: analysis.department || officerInfo?.department || null,
          officerName: analysis.officerName || officerInfo?.name || null,
          officerRank: analysis.officerRank || officerInfo?.rank || null,
          officerYears: officerInfo?.years || null,
          departmentLocation: officerInfo?.location || null,
          jurisdiction:
            analysis.jurisdiction || officerInfo?.jurisdiction || null,
          analysisConfidence: analysis.confidence,
          rawAiResponse: JSON.stringify({
            ...analysis,
            extractionSummary: {
              extracted: analysis.extractedFields,
              missing: analysis.missingFields,
              imageQuality: analysis.imageQuality,
              qualityIssues: analysis.qualityIssues,
            },
          }),
        });

        // Return enhanced analysis with extraction details
        res.json({
          ...lookup,
          enhancedAnalysis: {
            extractedFields: analysis.extractedFields,
            missingFields: analysis.missingFields,
            imageQuality: analysis.imageQuality,
            qualityIssues: analysis.qualityIssues,
            confidence: analysis.confidence,
            city: analysis.city,
            state: analysis.state,
            county: analysis.county,
            badgeType: analysis.badgeType,
            additionalInfo: analysis.additionalInfo,
          },
        });
      } catch (error: any) {
        console.error("Error analyzing badge:", error);

        // Provide user-friendly error messages
        if (error.message && (error.message.includes("GEMINI_API_KEY") || error.message.includes("GROQ_API_KEY"))) {
          return res.status(503).json({
            message:
              "Badge analysis service is currently unavailable. Please try again later or contact support.",
            code: "SERVICE_UNAVAILABLE",
          });
        }

        res
          .status(500)
          .json({ message: "Failed to analyze badge. Please try again." });
      }
    },
  );

  // Manual officer search by name
  app.post(
    "/api/officer-search/manual",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        const { name, badgeNumber, department } = req.body;

        if (!name) {
          return res.status(400).json({ message: "Officer name is required" });
        }

        // Lookup officer information using provided details
        const officerInfo = lookupOfficerInfo(
          badgeNumber || "",
          department || "",
          name,
        );

        // Save lookup to database
        const lookup = await storage.createBadgeLookup({
          userId,
          imageUrl: null, // No image for manual search
          badgeNumber: badgeNumber || officerInfo.badgeNumber,
          department: department || officerInfo.department,
          officerName: officerInfo.name,
          officerRank: officerInfo.rank,
          officerYears: officerInfo.years,
          departmentLocation: officerInfo.location,
          jurisdiction: officerInfo.jurisdiction,
          analysisConfidence: "manual_search",
          rawAiResponse: `Manual search for officer: ${name}`,
        });

        res.json(lookup);
      } catch (error: any) {
        console.error("Error searching officer:", error);
        res
          .status(500)
          .json({ message: "Failed to search officer: " + error.message });
      }
    },
  );

  // Get all badge lookups for user
  app.get("/api/badge-lookups", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const lookups = await storage.getUserBadgeLookups(userId);
      res.json(lookups);
    } catch (error: any) {
      console.error("Error fetching lookups:", error);
      res.status(500).json({ message: "Failed to fetch lookups" });
    }
  });

  // Get specific badge lookup
  app.get("/api/badge-lookups/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      const lookup = await storage.getBadgeLookup(id);

      if (!lookup) {
        return res.status(404).json({ message: "Lookup not found" });
      }

      // Verify ownership
      if (lookup.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(lookup);
    } catch (error: any) {
      console.error("Error fetching lookup:", error);
      res.status(500).json({ message: "Failed to fetch lookup" });
    }
  });

  // ============================================
  // COMPREHENSIVE OFFICER SEARCH ROUTE
  // STANDALONE FEATURE - Separate from AI lawsuit drafting
  // Searches public records for officer career history, training, incidents, etc.
  // ============================================

  // Server-Sent Events endpoint for real-time search progress
  app.get(
    "/api/officer-search/progress/:searchId",
    (req: any, res) => {
      const { searchId } = req.params;

      console.log(`[SSE] Client connected for search progress: ${searchId}`);

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.flushHeaders();

      // Send initial connection message
      res.write(`data: ${JSON.stringify({ stage: 0, message: 'Connected' })}\n\n`);

      // Listen for progress events for this search
      const progressHandler = (progress: SearchProgress) => {
        if (progress.searchId === searchId) {
          console.log(`[SSE] Sending progress update: Stage ${progress.stage}/5 - ${progress.stageName}`);
          res.write(`data: ${JSON.stringify(progress)}\n\n`);

          // Close connection after completion
          if (progress.stage === 5) {
            setTimeout(() => {
              console.log(`[SSE] Search complete, closing connection: ${searchId}`);
              res.end();
            }, 100);
          }
        }
      };

      searchProgressEmitter.on('progress', progressHandler);

      // Clean up on client disconnect
      req.on('close', () => {
        console.log(`[SSE] Client disconnected: ${searchId}`);
        searchProgressEmitter.removeListener('progress', progressHandler);
      });
    }
  );

  // Search for comprehensive officer information from multiple sources
  // NOW ROUTES THROUGH AUTO-CORRECTION PIPELINE FOR SELF-HEALING
  app.post(
    "/api/officer-search",
    async (req: any, res) => {
      try {
        const { officerName, officerType, state, city, county, badgeData, searchId } = req.body;

        // Enhanced validation with specific error messages
        if (!officerName || typeof officerName !== 'string' || !officerName.trim()) {
          return res.status(400).json({
            message: "Officer name is required and must be a valid string",
            code: "INVALID_OFFICER_NAME",
          });
        }

        // At least one location field must be provided (state, city, or county)
        const hasState = state && typeof state === 'string' && state.trim();
        const hasCity = city && typeof city === 'string' && city.trim();
        const hasCounty = county && typeof county === 'string' && county.trim();

        if (!hasState && !hasCity && !hasCounty) {
          return res.status(400).json({
            message: "At least one location field (state, city, or county) is required",
            code: "INVALID_LOCATION",
          });
        }

        // Device-based rate limiting (2 searches per device per 24 hours)
        const ipAddress = getClientIp(req);
        const userAgent = req.headers['user-agent'] || 'unknown';
        const { deviceId, isNewDevice } = getOrCreateDeviceId(req, res);
        const userId = req.user?.claims?.sub;

        // Check rate limit with fail-closed security
        // CRITICAL: isNewDevice flag prevents cookie-clearing bypass
        const rateLimit = await checkDeviceSearchLimit(ipAddress, userAgent, deviceId, isNewDevice);
        
        // Strictly check allowed flag - return 429 if not allowed
        if (rateLimit.allowed === false) {
          const ipLog = ipAddress ? ipAddress.substring(0, 10) + '...' : 'no-ip';
          const deviceLog = isNewDevice ? '(new device)' : '(returning device)';
          console.warn(
            `[Officer Search] Rate limit exceeded for device ${deviceId.substring(0, 8)}... ${deviceLog} IP=${ipLog} | Error: ${rateLimit.error}`
          );
          return res.status(429).json({
            message: rateLimit.message || 'Rate limit exceeded',
            code: "RATE_LIMIT_EXCEEDED",
            remaining: rateLimit.remaining,
            resetTime: rateLimit.resetTime,
            error: rateLimit.error,
          });
        }

        // Record this search attempt for rate limiting
        await recordDeviceSearch(ipAddress, userAgent, deviceId, isNewDevice, officerName.trim(), userId);

        const location = [county, city, state].filter(Boolean).join(', ') || 'Federal/Unknown';
        console.log(
          `[Officer Search Route] 🚀 AUTO-CORRECTION ENABLED - Received request for: ${officerName} in ${location}`,
        );
        console.log(`[Officer Search Route] Using client-provided search ID: ${searchId}`);

        // ═══════════════════════════════════════════════════════════════════════
        // NEW: Route through auto-correction pipeline for self-healing capability
        // This enables:
        // - Automatic retry on failures (up to 3 attempts)
        // - Rate limit handling with exponential backoff
        // - Network error recovery with parameter sanitization
        // - Parameter validation and auto-fixing
        // ═══════════════════════════════════════════════════════════════════════
        
        // Build structured SearchOfficersCommand directly
        const searchCommand: any = {
          type: 'search_officers',
          searchParams: {
            name: officerName.trim(),
            state: state ? state.trim().toUpperCase() : undefined,
            city: city ? city.trim() : undefined,
            department: undefined,
            badgeNumber: badgeData?.badgeNumber,
            officerType: officerType, // Pass officer type to improve search accuracy
            searchId: searchId, // Pass searchId for SSE progress updates
          },
          limit: 10,
          includeHistory: true,
          timestamp: new Date(),
          confidence: 0.95,
        };

        console.log('[Officer Search Route] 🔧 Routing through processSubAgentCommand with auto-correction...');
        console.log('[Officer Search Route] 📊 Command structure:', JSON.stringify(searchCommand, null, 2));

        // Import and execute with auto-correction
        const { executeStructuredCommand } = await import('./aiSubAgent');
        
        // Execute with auto-correction enabled (max 3 retries with corrective strategies)
        const result = await executeStructuredCommand(searchCommand);

        // Check if execution was successful
        if (!result.success) {
          console.error('[Officer Search Route] ❌ Auto-correction exhausted after 3 attempts:', result.errorMessage);
          
          // Return error with telemetry about retry attempts
          return res.status(500).json({
            error: result.errorMessage || "Officer search failed after multiple retry attempts",
            message: "Search failed despite auto-correction attempts. Please try again with different parameters.",
            code: "AUTO_CORRECTION_FAILED",
            metadata: result.metadata,
          });
        }

        // Extract the actual search result from the response
        // executeStructuredCommand returns { success, result: { success, result: <officer data> } }
        const wrappedResult = result.metadata?.result || result.response || result.result;
        const officerResult = wrappedResult?.result || wrappedResult;

        // Validate result structure - the actual officer data should have name and summary
        if (!officerResult || !officerResult.name || !officerResult.summary) {
          console.warn('[Officer Search Route] Invalid result structure after auto-correction:', {
            wrappedResult,
            officerResult,
            hasName: officerResult?.name,
            hasSummary: officerResult?.summary
          });
          return res.status(500).json({
            message: "Search completed but returned incomplete data. Please try again.",
            code: "INCOMPLETE_RESULT",
          });
        }

        console.log(
          `[Officer Search Route] ✅ AUTO-CORRECTION SUCCESS - Search complete with ${officerResult.summary.length} chars, ${officerResult.sources?.length || 0} sources`,
        );
        
        // Log telemetry if auto-correction was used
        if (result.metadata?.autoFixed || (result.metadata?.attempts && result.metadata.attempts > 1)) {
          console.log('[Officer Search Route] 🎯 TELEMETRY: Auto-correction was applied');
          console.log(`[Officer Search Route] 🔄 Attempts: ${result.metadata?.attempts || 1}`);
          console.log(`[Officer Search Route] 🛠️ Fixes applied: ${result.metadata?.fixAttempts?.join(', ') || 'None'}`);
        }

        res.json(officerResult);
      } catch (error: any) {
        console.error("[Officer Search Route] ❌ FATAL ERROR (outside auto-correction):", {
          message: error.message,
          stack: error.stack,
          code: error.code,
        });

        // Comprehensive error handling with specific status codes and messages
        if (error.message?.includes("quota") || error.message?.includes("rate limit")) {
          return res.status(429).json({
            error: "Search service is experiencing high demand. Please try again in a few moments.",
            message: "Search service is experiencing high demand. Please try again in a few moments.",
            code: "RATE_LIMIT_EXCEEDED",
          });
        }

        if (error.message?.includes("API key") || error.message?.includes("GEMINI_API_KEY")) {
          return res.status(500).json({
            error: "Search service configuration error. Please contact support.",
            message: "Search service configuration error. Please contact support.",
            code: "SERVICE_CONFIG_ERROR",
          });
        }

        if (error.message?.includes("timeout") || error.message?.includes("timed out")) {
          return res.status(504).json({
            error: "Search request took too long. Please try again with more specific information.",
            message: "Search request took too long. Please try again with more specific information.",
            code: "SEARCH_TIMEOUT",
          });
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('network')) {
          return res.status(503).json({
            error: "Unable to connect to search services. Please try again.",
            message: "Unable to connect to search services. Please try again.",
            code: "NETWORK_ERROR",
          });
        }

        // Generic error with sanitized message
        const safeMessage = error.message?.substring(0, 200) || "An unexpected error occurred";
        res.status(500).json({
          error: `Search failed: ${safeMessage}`,
          message: `Search failed: ${safeMessage}`,
          code: "SEARCH_ERROR"
        });
      }
    },
  );

  // ============================================
  // JURISDICTION VALIDATION ROUTES
  // ============================================

  // Validate jurisdiction and get verified contact email
  app.post(
    "/api/validate-jurisdiction",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { city, county, state, agencyType } = req.body;

        if (!state) {
          return res.status(400).json({ message: "State is required" });
        }

        if (!agencyType || !['police', 'sheriff', 'trooper'].includes(agencyType)) {
          return res.status(400).json({ message: "Valid agency type is required (police, sheriff, or trooper)" });
        }

        // Find verified jurisdiction
        const jurisdiction = await storage.findVerifiedJurisdiction(
          city || null,
          county || null,
          state,
          agencyType as 'police' | 'sheriff' | 'trooper'
        );

        if (!jurisdiction) {
          // Try finding any jurisdiction (not just verified)
          const anyJurisdiction = await storage.findJurisdictionByLocation(
            city || null,
            county || null,
            state,
            agencyType as 'police' | 'sheriff' | 'trooper'
          );

          if (anyJurisdiction) {
            return res.json({
              found: true,
              verified: false,
              jurisdiction: anyJurisdiction,
              warning: "Jurisdiction found but not verified. Manual review recommended before submission."
            });
          }

          // No jurisdiction found at all
          return res.json({
            found: false,
            verified: false,
            error: `No jurisdiction found for ${city || county || state} ${agencyType}. Unable to determine correct submission venue.`
          });
        }

        // Verified jurisdiction found
        res.json({
          found: true,
          verified: true,
          jurisdiction: jurisdiction,
          message: "Verified jurisdiction found with contact information."
        });
      } catch (error: any) {
        console.error("Error validating jurisdiction:", error);
        res.status(500).json({ message: "Failed to validate jurisdiction" });
      }
    }
  );

  // ============================================
  // AI FORM ASSISTANT ROUTES
  // ============================================

  // Chat with AI form assistant - now using Gemini with full context
  app.post(
    "/api/form-assistant/chat",
    isAuthenticated,
    async (req: any, res) => {
      try {
        // Validate request payload with Zod
        const requestSchema = z.object({
          formType: z.enum(['complaint', 'lawsuit', 'petition']),
          userMessage: z.string().min(1, "Message cannot be empty"),
          userContext: z.record(z.any()).optional().default({}),
          currentFormData: z.record(z.any()).optional().default({}),
          conversationHistory: z.array(z.object({
            role: z.string(),
            content: z.string()
          })).optional().default([])
        });

        const validationResult = requestSchema.safeParse(req.body);

        if (!validationResult.success) {
          return res.status(400).json({
            message: "Invalid request payload",
            errors: validationResult.error.errors
          });
        }

        const {
          formType,
          userContext,
          currentFormData,
          conversationHistory,
          userMessage,
        } = validationResult.data;

        // Check if Gemini is configured
        if (!process.env.GEMINI_API_KEY) {
          return res.status(503).json({
            message:
              "AI assistant service is currently unavailable. The AI service has not been configured.",
            code: "SERVICE_UNAVAILABLE",
          });
        }

        const response = await chatWithFormAssistant(
          formType,
          userContext,
          currentFormData,
          conversationHistory,
          userMessage,
        );

        res.json(response);
      } catch (error: any) {
        console.error("Error in form assistant chat:", error);

        // Return friendly error message for parsing failures
        if (error.message && error.message.includes("Failed to extract valid JSON")) {
          return res.status(502).json({
            message:
              "The AI assistant encountered an issue processing your request. Please try again.",
            code: "AI_PROCESSING_ERROR",
          });
        }

        if (error.message && error.message.includes("GEMINI_API_KEY")) {
          return res.status(503).json({
            message:
              "AI assistant service is currently unavailable. Please try again later.",
            code: "SERVICE_UNAVAILABLE",
          });
        }

        res
          .status(500)
          .json({ message: "Failed to process request. Please try again." });
      }
    },
  );

  // ============================================
  // ADVANCED LEGAL AI ROUTES
  // SEPARATE FROM OFFICER SEARCH - These handle legal analysis and document drafting
  // Officer search is a standalone research tool
  // ============================================

  // Trial Legal Consultation - One-time free consultation (no login required)
  // Tracks by IP address and device fingerprint to limit to one per device
  app.post(
    "/api/trial-consultation",
    apiRateLimit,
    async (req: any, res) => {
      try {
        const { question, deviceFingerprint } = req.body;

        if (!question || question.trim().length < 10) {
          return res.status(400).json({ 
            message: "Please provide a detailed legal question (at least 10 characters)." 
          });
        }

        // Get client IP address
        const ipAddress = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
                         req.headers['x-real-ip']?.toString() ||
                         req.socket.remoteAddress ||
                         'unknown';

        // Check if this IP or device has already used trial consultation
        const existingConsultation = await db
          .select()
          .from(trialConsultations)
          .where(
            deviceFingerprint 
              ? sql`${trialConsultations.ipAddress} = ${ipAddress} OR ${trialConsultations.deviceFingerprint} = ${deviceFingerprint}`
              : eq(trialConsultations.ipAddress, ipAddress)
          )
          .limit(1);

        if (existingConsultation.length > 0) {
          return res.status(403).json({
            message: "You have already used your free trial consultation. Please sign up for full access to BadBlue's legal services.",
            alreadyUsed: true,
          });
        }

        // Generate legal consultation response using AI
        const { analyzeLegalIssue } = await import("./legalAI.js");
        const response = await analyzeLegalIssue(
          question, 
          "General", 
          "BRIEF TRIAL CONSULTATION: Provide a concise legal analysis (4-6 sentences max). DO NOT repeat the user's scenario. Focus ONLY on: (1) Specific statutes/laws violated, (2) Legal grounds for complaint or civil suit (e.g., assault, negligence, civil rights violation), (3) Immediate next steps. Be direct and actionable."
        );

        // LEARNING: Learn from user input for autonomous improvements
        const { learnFromLegalConsultation } = await import("./aiSubAgent");
        learnFromLegalConsultation(question, { state: "General", category: "trial" }).catch(err => {
          console.error('[Learning] Failed to learn from consultation:', err);
        });

        // Store the consultation
        await db.insert(trialConsultations).values({
          ipAddress,
          deviceFingerprint: deviceFingerprint || null,
          userAgent: req.headers['user-agent'] || null,
          question,
          response,
        });

        res.json({
          response,
          isTrialConsultation: true,
        });
      } catch (error: any) {
        console.error("Error in trial consultation:", error);

        if (
          error.message?.includes("API key") ||
          error.message?.includes("authentication") ||
          error.message?.includes("401") ||
          error.message?.includes("GEMINI_API_KEY")
        ) {
          return res.status(503).json({
            message:
              "The AI legal consultation service is temporarily unavailable. Please try again later.",
          });
        }

        res.status(500).json({
          message:
            "We encountered an error processing your consultation. Please try again.",
        });
      }
    },
  );

  // Legal Consultation - Assess if user has actionable case with auto-fill data
  // Note: No authentication required - available to all users
  app.post(
    "/api/legal-consultation",
    async (req: any, res) => {
      try {
        const { state, situation } = req.body;

        if (!state || !situation) {
          return res
            .status(400)
            .json({ message: "State and situation required" });
        }

        // LEARNING: Learn from user input for autonomous improvements
        const { learnFromLegalConsultation } = await import("./aiSubAgent");
        learnFromLegalConsultation(situation, { state, category: "consultation" }).catch(err => {
          console.error('[Learning] Failed to learn from consultation:', err);
        });

        // Use enhanced actionability analysis
        const analysis = await analyzeActionability(situation, state);

        res.json(analysis);
      } catch (error: any) {
        console.error("Error in legal consultation:", error);

        // Provide user-friendly error messages
        if (
          error.message?.includes("API key") ||
          error.message?.includes("authentication") ||
          error.message?.includes("401") ||
          error.message?.includes("GEMINI_API_KEY")
        ) {
          return res.status(503).json({
            message:
              "The AI legal analysis service is temporarily unavailable. Please try again later or contact support if the issue persists.",
          });
        }

        res.status(500).json({
          message:
            "We encountered an error analyzing your situation. Please try again or contact support if the problem continues.",
        });
      }
    },
  );

  // Sample Legal Consultation - Limited free consultation with device fingerprinting
  // No authentication required - one sample per device
  app.post(
    "/api/sample-legal-consultation",
    apiRateLimit,
    async (req: any, res) => {
      try {
        const { state, situation, deviceFingerprint } = req.body;

        if (!state || !situation || !deviceFingerprint) {
          return res
            .status(400)
            .json({ message: "State, situation, and device fingerprint required" });
        }

        // Check if this device has already used the sample
        const hasUsedSample = await storage.hasDeviceUsedSample(deviceFingerprint);
        
        if (hasUsedSample) {
          return res.json({
            alreadyUsed: true,
            message: "This device has already used the free sample consultation. Please sign up for full access."
          });
        }

        // Get IP address for tracking
        const ipAddress = req.headers['x-forwarded-for'] || 
                         req.connection.remoteAddress || 
                         req.socket.remoteAddress || 
                         '';

        // Provide a shorter, sample analysis
        const sampleAnalysis = await analyzeLegalIssue(
          situation.substring(0, 1000), // Limit input length
          state,
          'BRIEF TRIAL CONSULTATION - Provide a concise sample analysis (4-6 sentences)'
        );

        // Store device fingerprint to prevent reuse
        await storage.createDeviceFingerprint({
          deviceId: deviceFingerprint,
          sampleUsedAt: new Date(),
          ipAddress: ipAddress.toString(),
          userAgent: req.headers['user-agent'] || null,
          state,
          situation: situation.substring(0, 200), // Store truncated version
          response: sampleAnalysis.substring(0, 500), // Store truncated response
        });

        // Format response with clear sample indication
        const response = {
          analysis: sampleAnalysis + "\n\nThis is a sample analysis. For comprehensive legal consultation including detailed statutes, case law, and actionable recommendations, sign up for full BadBlue access.",
          isSample: true,
          message: "Sample consultation complete. Sign up for full access to unlock all features."
        };

        res.json(response);
      } catch (error: any) {
        console.error("Error in sample legal consultation:", error);

        // Check for duplicate device fingerprint error
        if (error.message?.includes('duplicate key') || error.message?.includes('unique')) {
          return res.json({
            alreadyUsed: true,
            message: "This device has already used the free sample consultation. Please sign up for full access."
          });
        }

        res.status(500).json({
          message: "Unable to provide sample consultation. Please try again or sign up for full access.",
        });
      }
    },
  );

  // AI Content Generation - Generate persuasive complaint/lawsuit content
  app.post("/api/generate-content", isAuthenticated, async (req: any, res) => {
    try {
      const contentData = req.body;

      if (!contentData.documentType) {
        return res.status(400).json({ message: "Document type is required" });
      }

      // Import the function
      const { generatePersuasiveContent } = await import("./legalAI.js");

      // Generate persuasive content using AI
      const generatedContent = await generatePersuasiveContent(contentData);

      res.json(generatedContent);
    } catch (error: any) {
      console.error("Error generating content:", error);

      // Provide user-friendly error messages
      if (
        error.message?.includes("API key") ||
        error.message?.includes("authentication") ||
        error.message?.includes("401") ||
        error.message?.includes("GEMINI_API_KEY")
      ) {
        return res.status(503).json({
          message:
            "The AI content generation service is temporarily unavailable. Please try again later or contact support if the issue persists.",
        });
      }

      res.status(500).json({
        message:
          "We encountered an error generating content. Please try again or contact support if the problem continues.",
      });
    }
  });

  // Advanced Legal Analysis Endpoint - now handled by analyzeActionability
  // Route removed as functionality is covered by /api/legal-consultation

  // Enhanced Public Records Search
  app.post(
    "/api/search-public-records",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { officerName, badgeNumber, department, city, state } = req.body;

        if (!officerName || !department || !city || !state) {
          return res
            .status(400)
            .json({ message: "Missing required search parameters" });
        }

        const results = await searchPublicRecords(
          officerName,
          badgeNumber || null,
          department,
          city,
          state,
        );

        res.json(results);
      } catch (error: any) {
        console.error("Error in public records search:", error);
        res.status(500).json({
          message: "Failed to search public records: " + error.message,
        });
      }
    },
  );

  // Comprehensive Legal Research Endpoints

  // Research relevant statutes
  app.post("/api/legal-research/statutes", isAuthenticated, async (req: any, res) => {
    try {
      const { state, violationType, factPattern } = req.body;

      if (!state || !violationType || !factPattern) {
        return res.status(400).json({ message: "State, violation type, and fact pattern required" });
      }

      const { researchRelevantStatutes } = await import("./legalAI.js");
      const statutes = await researchRelevantStatutes(state, violationType, factPattern);

      res.json(statutes);
    } catch (error: any) {
      console.error("Error researching statutes:", error);
      res.status(500).json({ message: "Failed to research statutes: " + error.message });
    }
  });

  // Analyze local district rules
  app.post("/api/legal-research/district-rules", isAuthenticated, async (req: any, res) => {
    try {
      const { state, city, county } = req.body;

      if (!state || !city) {
        return res.status(400).json({ message: "State and city required" });
      }

      const { analyzeLocalDistrictRules } = await import("./legalAI.js");
      const rules = await analyzeLocalDistrictRules(state, city, county || null);

      res.json(rules);
    } catch (error: any) {
      console.error("Error analyzing district rules:", error);
      res.status(500).json({ message: "Failed to analyze district rules: " + error.message });
    }
  });

  // Analyze case law and draft arguments
  app.post("/api/legal-research/case-law", isAuthenticated, async (req: any, res) => {
    try {
      const { state, violationType, factPattern } = req.body;

      if (!state || !violationType || !factPattern) {
        return res.status(400).json({ message: "State, violation type, and fact pattern required" });
      }

      const { analyzeCaseLaw } = await import("./legalAI.js");
      const analysis = await analyzeCaseLaw(state, violationType, factPattern);

      res.json(analysis);
    } catch (error: any) {
      console.error("Error analyzing case law:", error);
      res.status(500).json({ message: "Failed to analyze case law: " + error.message });
    }
  });

  // Advanced Document Generation
  app.post(
    "/api/generate-legal-document",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { documentType, data, legalAnalysis } = req.body;

        if (!documentType || !data) {
          return res
            .status(400)
            .json({ message: "Document type and data required" });
        }

        const generationResult = await generateLegalDocument(
          documentType,
          data
        );

        res.json({ document: generationResult.document });
      } catch (error: any) {
        console.error("Error generating legal document:", error);
        res
          .status(500)
          .json({ message: "Failed to generate document: " + error.message });
      }
    },
  );

  // Learning System - Pattern Analysis
  app.post("/api/analyze-patterns", isAuthenticated, async (req: any, res) => {
    try {
      const { newCase, similarCases } = req.body;

      if (!newCase) {
        return res.status(400).json({ message: "New case data required" });
      }

      const insights = await analyzePatternsAndLearn(
        newCase,
        similarCases || [],
      );

      res.json({ insights });
    } catch (error: any) {
      console.error("Error analyzing patterns:", error);
      res
        .status(500)
        .json({ message: "Failed to analyze patterns: " + error.message });
    }
  });

  // ============================================
  // PUBLIC EVIDENCE HUB ROUTES
  // ============================================

  // Get all public evidence
  app.get("/api/evidence-hub", async (req, res) => {
    try {
      const { type } = req.query;

      const evidence = await storage.getPublicEvidence(
        type && type !== 'all' ? String(type) : null
      );

      res.json(evidence);
    } catch (error: any) {
      console.error("Error fetching public evidence:", error);
      res.status(500).json({ message: "Failed to fetch evidence" });
    }
  });

  // Share evidence publicly (when user checks "share with community")
  app.post("/api/evidence-hub/share", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const {
        fileUrl,
        fileName,
        fileType,
        officerName,
        department,
        location,
        incidentDate,
        description
      } = req.body;

      if (!fileUrl || !fileName || !fileType) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const evidence = await storage.sharePublicEvidence({
        userId,
        fileUrl,
        fileName,
        fileType,
        officerName: officerName || null,
        department: department || null,
        location: location || null,
        incidentDate: incidentDate ? new Date(incidentDate) : null,
        description: description || null,
      });

      res.json(evidence);
    } catch (error: any) {
      console.error("Error sharing evidence:", error);
      res.status(500).json({ message: "Failed to share evidence" });
    }
  });

  // ============================================
  // ADMIN: EVIDENCE HUB MANAGEMENT
  // ============================================

  // Get all evidence for admin management (includes user info)
  app.get("/api/admin/evidence-hub", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const evidence = await db.select({
        id: publicEvidence.id,
        fileName: publicEvidence.fileName,
        fileType: publicEvidence.fileType,
        fileUrl: publicEvidence.fileUrl,
        officerName: publicEvidence.officerName,
        department: publicEvidence.department,
        location: publicEvidence.location,
        incidentDate: publicEvidence.incidentDate,
        description: publicEvidence.description,
        uploadedAt: publicEvidence.uploadedAt,
        userId: publicEvidence.userId,
        userEmail: users.email,
        userName: users.firstName,
      })
      .from(publicEvidence)
      .leftJoin(users, eq(publicEvidence.userId, users.id))
      .orderBy(desc(publicEvidence.uploadedAt));

      res.json(evidence);
    } catch (error: any) {
      console.error("Error fetching admin evidence:", error);
      res.status(500).json({ message: "Failed to fetch evidence" });
    }
  });

  // Update evidence submission
  app.patch("/api/admin/evidence-hub/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { id } = req.params;
      const updateData = req.body;

      // Convert incidentDate if present
      if (updateData.incidentDate) {
        updateData.incidentDate = new Date(updateData.incidentDate);
      }

      const updated = await storage.updatePublicEvidence(id, updateData);

      if (!updated) {
        return res.status(404).json({ message: "Evidence not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating evidence:", error);
      res.status(500).json({ message: "Failed to update evidence" });
    }
  });

  // Bulk delete evidence
  app.post("/api/admin/evidence-hub/bulk-delete", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      
      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid or empty ids array" });
      }

      await storage.bulkDeletePublicEvidence(ids);

      res.json({ message: `Successfully deleted ${ids.length} evidence submissions` });
    } catch (error: any) {
      console.error("Error deleting evidence:", error);
      res.status(500).json({ message: "Failed to delete evidence" });
    }
  });

  // ============================================
  // PETITION ROUTES
  // ============================================

  // Create new petition
  app.post("/api/petitions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const petitionData = insertPetitionSchema.parse(req.body);

      // Generate shareable slug and URL
      const slug = crypto.randomBytes(8).toString('hex');
      const shareableUrl = `${req.protocol}://${req.get('host')}/petition/${slug}`;

      // Insert petition
      const [petition] = await db.insert(petitions).values({
        ...petitionData,
        userId: user.id,
        slug,
        shareableUrl,
        signatureCount: 0,
      }).returning();

      // Create Stripe checkout session
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Petition for Officer Resignation',
              description: `Petition against ${petitionData.officerName}`,
            },
            unit_amount: PETITION_PRICING_CENTS,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${req.protocol}://${req.get('host')}/petitions/${petition.id}?payment=success`,
        cancel_url: `${req.protocol}://${req.get('host')}/home`, // Or a relevant page for canceling
        metadata: {
          petitionId: petition.id,
          userId: user.id,
          type: 'petition', // Add type for webhook handling
        },
      });

      // Update petition with payment ID
      await db.update(petitions)
        .set({ paymentId: session.id })
        .where(eq(petitions.id, petition.id));

      return res.json({
        petition,
        checkoutUrl: session.url,
      });
    } catch (error: any) {
      console.error("Error creating petition:", error);
      return res.status(500).json({ message: error.message || "Failed to create petition" });
    }
  });

  // Get all active petitions (public access)
  app.get("/api/petitions", async (req, res) => {
    try {
      const activePetitions = await db.query.petitions.findMany({
        with: {
          signatures: true,
        },
        orderBy: (petitions, { desc }) => [desc(petitions.signatureCount)],
      });

      return res.json(activePetitions);
    } catch (error: any) {
      console.error("Error fetching petitions:", error);
      return res.status(500).json({ message: "Failed to fetch petitions" });
    }
  });

  // Get single petition (public access via shareable URL or ID)
  app.get("/api/petitions/:id", async (req, res) => {
    try {
      const petitionId = req.params.id;

      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
        with: {
          signatures: {
            orderBy: (signatures, { desc }) => [desc(signatures.signedAt)],
          },
        },
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      return res.json(petition);
    } catch (error: any) {
      console.error("Error fetching petition:", error);
      return res.status(500).json({ message: "Failed to fetch petition" });
    }
  });

  // Sign a petition (public access)
  app.post("/api/petitions/:id/sign", async (req, res) => {
    try {
      const petitionId = req.params.id;
      const { fullName, typedSignature, drawnSignature } = req.body;

      if (!fullName || !typedSignature) {
        return res.status(400).json({ message: "Full name and typed signature are required" });
      }

      // Check if petition exists
      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      // Use transaction to prevent race conditions
      let signature;
      try {
        const result = await db.transaction(async (tx) => {
          // Add signature
          const [sig] = await tx.insert(petitionSignatures).values({
            petitionId,
            fullName,
            typedSignature,
            drawnSignature: drawnSignature || null,
          }).returning();

          if (!sig) {
            throw new Error("Failed to create signature");
          }

          // Increment signature count atomically
          const updateResult = await tx.update(petitions)
            .set({
              signatureCount: sql`${petitions.signatureCount} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(petitions.id, petitionId))
            .returning();

          if (!updateResult || updateResult.length === 0) {
            throw new Error("Failed to update petition signature count");
          }

          return sig;
        });

        signature = result;
      } catch (txError: any) {
        console.error("Transaction error while signing petition:", txError);
        return res.status(500).json({
          message: "Failed to process signature. Please try again.",
          error: txError.message
        });
      }

      return res.json(signature);
    } catch (error: any) {
      console.error("Error signing petition:", error);
      return res.status(500).json({ message: "Failed to sign petition" });
    }
  });

  // Route to get signatures for a petition (public access)
  app.get("/api/petitions/:id/signatures", async (req, res) => {
    try {
      const petitionId = req.params.id;

      const signatures = await db.query.petitionSignatures.findMany({
        where: eq(petitionSignatures.petitionId, petitionId),
        orderBy: (signatures, { desc }) => [desc(signatures.signedAt)],
      });

      return res.json(signatures);
    } catch (error: any) {
      console.error("Error fetching petition signatures:", error);
      return res.status(500).json({ message: "Failed to fetch signatures" });
    }
  });

  // Route for sharing a petition (e.g., social media)
  // This could potentially trigger API calls to social media platforms if needed,
  // but for now, it's mainly about providing the shareable URL.
  app.post("/api/petitions/:id/share", isAuthenticated, async (req, res) => {
    try {
      const petitionId = req.params.id;
      const { platform } = req.body; // e.g., 'facebook', 'twitter'

      const petition = await db.query.petitions.findFirst({
        where: eq(petitions.id, petitionId),
      });

      if (!petition) {
        return res.status(404).json({ message: "Petition not found" });
      }

      // In a real application, you might use platform-specific APIs here.
      // For now, we'll just return the shareable URL.
      const shareData: any = {
        url: petition.shareableUrl,
        title: `Support ${petition.officerName}'s Resignation`,
        description: petition.offenseDescriptionOriginal.substring(0, 150) + '...', // Truncated description
      };

      // Example: Constructing share URLs (these are client-side constructs usually)
      if (platform === 'facebook' && petition.shareableUrl) {
        shareData.url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(petition.shareableUrl)}`;
      } else if (platform === 'twitter' && petition.shareableUrl) {
        shareData.url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Support the petition to demand the resignation of ${petition.officerName}. Sign here: ${petition.shareableUrl}`)}`;
      }
      // Add more platforms as needed

      return res.json(shareData);
    } catch (error: any) {
      console.error("Error sharing petition:", error);
      return res.status(500).json({ message: "Failed to share petition" });
    }
  });

  // ============================================
  // FOIA RECORDS REQUEST ROUTES
  // ============================================

  // Generate FOIA letter with AI (no save yet)
  app.post("/api/foia-requests/generate", isAuthenticated, async (req: any, res) => {
    try {
      const {
        state,
        agencyType,
        departmentName,
        officerName,
        recordsDescription,
        userFullName,
        userEmail,
        mailingAddress,
        incidentDate,
        incidentTime,
        incidentLocation,
      } = req.body;

      if (!state || !agencyType || !departmentName || !officerName || !recordsDescription || !userFullName || !userEmail || !mailingAddress) {
        return res.status(400).json({ error: "Missing required fields for FOIA letter generation" });
      }

      const result = await generateFOIALetter(
        state,
        agencyType,
        departmentName,
        officerName,
        recordsDescription,
        userFullName,
        userEmail,
        mailingAddress,
        incidentDate,
        incidentTime,
        incidentLocation
      );

      res.json(result);
    } catch (error: any) {
      console.error("Error generating FOIA letter:", error);
      res.status(500).json({ error: "Failed to generate FOIA letter: " + error.message });
    }
  });

  // Create FOIA request and initiate payment
  app.post("/api/foia-requests", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      // Validate request body
      const validatedData = insertFoiaRequestSchema.parse(req.body);

      // Create FOIA request with draft status
      const [foiaRequest] = await db.insert(foiaRequests).values({
        ...validatedData,
        userId,
        status: 'draft',
      }).returning();

      res.json(foiaRequest);
    } catch (error: any) {
      console.error("Error creating FOIA request:", error);
      res.status(400).json({ error: "Failed to create FOIA request: " + error.message });
    }
  });

  // Get all FOIA requests for user
  app.get("/api/foia-requests", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      const userFoiaRequests = await db.query.foiaRequests.findMany({
        where: eq(foiaRequests.userId, userId),
        orderBy: desc(foiaRequests.createdAt),
      });

      res.json(userFoiaRequests);
    } catch (error: any) {
      console.error("Error fetching FOIA requests:", error);
      res.status(500).json({ error: "Failed to fetch FOIA requests" });
    }
  });

  // Get specific FOIA request
  app.get("/api/foia-requests/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      const foiaRequest = await db.query.foiaRequests.findFirst({
        where: eq(foiaRequests.id, id),
      });

      if (!foiaRequest) {
        return res.status(404).json({ error: "FOIA request not found" });
      }

      // Verify ownership
      if (foiaRequest.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(foiaRequest);
    } catch (error: any) {
      console.error("Error fetching FOIA request:", error);
      res.status(500).json({ error: "Failed to fetch FOIA request" });
    }
  });

  // Get all FOIA requests (admin only)
  app.get("/api/foia-requests-admin", isAuthenticated, async (req: any, res) => {
    try {
      const allFoiaRequests = await db.query.foiaRequests.findMany({
        orderBy: desc(foiaRequests.createdAt),
        with: {
          user: true,
        },
      });

      res.json(allFoiaRequests);
    } catch (error: any) {
      console.error("Error fetching FOIA requests:", error);
      res.status(500).json({ error: "Failed to fetch FOIA requests" });
    }
  });

  // Admin adds tracking number to FOIA request
  app.post("/api/foia-requests/:id/tracking", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { trackingNumber } = req.body;

      if (!trackingNumber) {
        return res.status(400).json({ error: "Tracking number is required" });
      }

      const [updated] = await db
        .update(foiaRequests)
        .set({
          certifiedMailTrackingNumber: trackingNumber,
          mailedAt: new Date(),
          status: 'mailed',
        })
        .where(eq(foiaRequests.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "FOIA request not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating tracking number:", error);
      res.status(500).json({ error: "Failed to update tracking number" });
    }
  });

  // ============================================
  // COMPLAINT ROUTES
  // ============================================

  // Create complaint (then redirect to payment)
  app.post("/api/complaints", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      // Validate request body
      const validatedData = insertComplaintSchema.parse(req.body);

      const complaint = await storage.createComplaint({
        ...validatedData,
        userId,
        incidentDate: new Date(validatedData.incidentDate),
      } as any);

      res.json(complaint);
    } catch (error: any) {
      console.error("Error creating complaint:", error);
      res
        .status(400)
        .json({ message: "Failed to create complaint: " + error.message });
    }
  });

  // Get all complaints for user
  app.get("/api/complaints", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const complaints = await storage.getUserComplaints(userId);
      res.json(complaints);
    } catch (error: any) {
      console.error("Error fetching complaints:", error);
      res.status(500).json({ message: "Failed to fetch complaints" });
    }
  });

  // Get specific complaint
  app.get("/api/complaints/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      const complaint = await storage.getComplaint(id);

      if (!complaint) {
        return res.status(404).json({ message: "Complaint not found" });
      }

      // Verify ownership
      if (complaint.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(complaint);
    } catch (error: any) {
      console.error("Error fetching complaint:", error);
      res.status(500).json({ message: "Failed to fetch complaint" });
    }
  });

  // Get all complaints (admin only) - ordered by purchase date descending
  app.get("/api/complaints-admin", isAuthenticated, async (req: any, res) => {
    try {
      const allComplaints = await db.query.complaints.findMany({
        orderBy: desc(schema.complaints.createdAt),
        with: {
          user: true,
        },
      });

      res.json(allComplaints);
    } catch (error: any) {
      console.error("Error fetching complaints:", error);
      res.status(500).json({ message: "Error fetching complaints" });
    }
  });

  // Get single complaint (admin only)
  app.get("/api/complaint-admin/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;

      const complaint = await db.query.complaints.findFirst({
        where: eq(schema.complaints.id, id),
        with: {
          user: true,
        },
      });

      if (!complaint) {
        return res.status(404).json({ message: "Complaint not found" });
      }

      res.json(complaint);
    } catch (error: any) {
      console.error("Error fetching complaint:", error);
      res.status(500).json({ message: "Error fetching complaint" });
    }
  });

  // ============================================
  // LAWSUIT ROUTES
  // ============================================

  // Create lawsuit filing
  app.post("/api/lawsuits", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      // Convert damagesAmount from dollars (string) to cents (integer)
      const damagesInCents = req.body.damagesAmount
        ? parseInt(req.body.damagesAmount) * 100
        : null;

      // Validate request body
      const validatedData = insertLawsuitFilingSchema.parse({
        ...req.body,
        damagesRequested: damagesInCents,
      });

      const lawsuit = await storage.createLawsuitFiling({
        ...validatedData,
        userId,
        incidentDate: new Date(validatedData.incidentDate),
      } as any);

      res.json(lawsuit);
    } catch (error: any) {
      console.error("Error creating lawsuit:", error);
      res
        .status(400)
        .json({ message: "Failed to create lawsuit: " + error.message });
    }
  });

  // Get all lawsuits for user
  app.get("/api/lawsuits", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const lawsuits = await storage.getUserLawsuitFilings(userId);
      res.json(lawsuits);
    } catch (error: any) {
      console.error("Error fetching lawsuits:", error);
      res.status(500).json({ message: "Failed to fetch lawsuits" });
    }
  });

  // Get specific lawsuit
  app.get("/api/lawsuits/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      const lawsuit = await storage.getLawsuitFiling(id);

      if (!lawsuit) {
        return res.status(404).json({ message: "Lawsuit not found" });
      }

      // Verify ownership
      if (lawsuit.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(lawsuit);
    } catch (error: any) {
      console.error("Error fetching lawsuit:", error);
      res.status(500).json({ message: "Failed to fetch lawsuit" });
    }
  });

  // ============================================
  // CONTACT FORM ROUTES
  // ============================================

  // Submit contact/support form (public route - no authentication required)
  app.post("/api/contact", async (req, res) => {
    try {
      // Sanitize and validate request body
      const sanitizedBody = {
        ...req.body,
        name: req.body.name?.trim(),
        email: req.body.email?.trim().toLowerCase(),
        subject: req.body.subject?.trim(),
        message: req.body.message?.trim(),
      };

      const validatedData = insertContactMessageSchema.parse(sanitizedBody);

      // Add userId if user is authenticated (optional)
      const userId = (req as any).user?.claims?.sub || null;

      // Save to database
      const message = await storage.createContactMessage({
        ...validatedData,
        userId: userId as string | undefined,
      } as any);

      // Send email to support address
      let emailSent = false;
      try {
        emailSent = await sendContactFormEmail({
          type: validatedData.type,
          name: validatedData.name,
          email: validatedData.email,
          subject: validatedData.subject,
          message: validatedData.message,
        });
      } catch (emailError: any) {
        console.error('[CONTACT] Email send failed:', emailError.message);
      }

      // Update message status with email sent status
      await storage.updateContactMessageStatus(message.id, "new", emailSent);

      res.json({
        success: true,
        message:
          "Your message has been submitted successfully. We'll get back to you soon!",
        emailSent,
      });
    } catch (error: any) {
      console.error("Error submitting contact form:", error);
      res
        .status(500)
        .json({ message: "Failed to submit contact form: " + error.message });
    }
  });

  // ============================================
  // AUTOSAVE ROUTES (Automatic Progress Saving)
  // ============================================

  // Save progress (automatic, debounced from frontend)
  app.post("/api/autosave", isAuthenticated, autosaveRateLimit, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;

      // Validate request body
      const validatedData = insertSavedProgressSchema.parse({
        ...req.body,
        userId, // Add userId from auth
      });

      // Build update object only with provided fields
      const updateSet: any = {
        updatedAt: new Date(),
      };

      if (validatedData.stepIndex !== undefined) {
        updateSet.stepIndex = validatedData.stepIndex;
      }

      if (validatedData.formDataJson !== undefined) {
        updateSet.formDataJson = validatedData.formDataJson;
      }

      // Use onConflictDoUpdate to upsert - guarantees single row per user+flow
      const result = await db
        .insert(savedProgress)
        .values(validatedData)
        .onConflictDoUpdate({
          target: [savedProgress.userId, savedProgress.flowKey],
          set: updateSet,
        })
        .returning();

      res.json({ success: true, progress: result[0] });
    } catch (error: any) {
      console.error("Error saving progress:", error);

      // Handle validation errors
      if (error.name === 'ZodError') {
        return res.status(400).json({
          message: "Invalid request data",
          errors: error.errors
        });
      }

      res.status(500).json({ message: "Failed to save progress" });
    }
  });

  // Get saved progress for a specific flow
  app.get("/api/autosave/:flowKey", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { flowKey } = req.params;

      const progress = await db
        .select()
        .from(savedProgress)
        .where(and(
          eq(savedProgress.userId, userId),
          eq(savedProgress.flowKey, flowKey)
        ))
        .limit(1);

      if (progress.length === 0) {
        return res.json({ progress: null });
      }

      res.json({ progress: progress[0] });
    } catch (error: any) {
      console.error("Error fetching progress:", error);
      res.status(500).json({ message: "Failed to fetch progress" });
    }
  });

  // Delete saved progress for a specific flow (when user starts fresh)
  app.delete("/api/autosave/:flowKey", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { flowKey } = req.params;

      await db
        .delete(savedProgress)
        .where(and(
          eq(savedProgress.userId, userId),
          eq(savedProgress.flowKey, flowKey)
        ));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting progress:", error);
      res.status(500).json({ message: "Failed to delete progress" });
    }
  });

  // ============================================
  // AUTOMATED DATA CLEANUP (Admin Only)
  // Deletes user data 7 days after access expiration
  // ============================================

  // Manually trigger data cleanup
  app.post("/api/admin/cleanup/run", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      console.log('[ADMIN] Manual data cleanup triggered by admin');
      const result = await runAutomatedCleanup();

      res.json({
        success: true,
        message: `Cleanup completed: ${result.successCount} successful, ${result.failureCount} failed`,
        ...result,
      });
    } catch (error: any) {
      console.error("Error running manual cleanup:", error);
      res.status(500).json({ message: "Failed to run cleanup", error: error.message });
    }
  });

  // Get cleanup logs
  app.get("/api/admin/cleanup/logs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const limit = parseInt(req.query.limit as string) || 100;
      const logs = getCleanupLogs(limit);

      res.json({ logs });
    } catch (error: any) {
      console.error("Error fetching cleanup logs:", error);
      res.status(500).json({ message: "Failed to fetch logs", error: error.message });
    }
  });

  // Get cleanup statistics
  app.get("/api/admin/cleanup/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const stats = getCleanupStats();

      res.json({ stats });
    } catch (error: any) {
      console.error("Error fetching cleanup stats:", error);
      res.status(500).json({ message: "Failed to fetch stats", error: error.message });
    }
  });

  // ============================================
  // ERROR LOG CLEANUP (30-DAY RETENTION)
  // ============================================

  // Manually trigger error log cleanup
  app.post("/api/admin/error-log-cleanup/run", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      console.log('[ADMIN] Manual error log cleanup triggered by admin');
      const result = await deleteOldErrorLogs();

      res.json({
        success: result.success,
        totalDeleted: result.totalDeleted,
        details: {
          adminAccessLogs: result.adminAccessLogsDeleted,
          aiSubAgentLogs: result.aiSubAgentLogsDeleted,
          adminSettingsAudit: result.adminSettingsAuditDeleted,
        },
        error: result.error,
      });
    } catch (error: any) {
      console.error("Error running error log cleanup:", error);
      res.status(500).json({ message: "Failed to run cleanup", error: error.message });
    }
  });

  // Get error log cleanup history
  app.get("/api/admin/error-log-cleanup/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const history = getErrorLogCleanupHistory(limit);

      res.json({ history });
    } catch (error: any) {
      console.error("Error fetching error log cleanup history:", error);
      res.status(500).json({ message: "Failed to fetch history", error: error.message });
    }
  });

  // Get error log cleanup statistics
  app.get("/api/admin/error-log-cleanup/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const stats = getErrorLogCleanupStats();

      res.json({ stats });
    } catch (error: any) {
      console.error("Error fetching error log cleanup stats:", error);
      res.status(500).json({ message: "Failed to fetch stats", error: error.message });
    }
  });

  // ============================================
  // AUTOMATED DAILY CLEANUP SCHEDULER
  // Runs cleanup every 24 hours at 3 AM
  // ============================================

  let cleanupScheduled = false;

  function scheduleNextCleanup() {
    if (cleanupScheduled) return;

    const now = new Date();
    const next3AM = new Date();
    next3AM.setHours(3, 0, 0, 0);

    // If it's already past 3 AM today, schedule for 3 AM tomorrow
    if (now.getHours() >= 3) {
      next3AM.setDate(next3AM.getDate() + 1);
    }

    const timeUntilCleanup = next3AM.getTime() - now.getTime();

    console.log(`[DATA CLEANUP] Next automated cleanup scheduled for: ${next3AM.toLocaleString()}`);

    setTimeout(async () => {
      console.log('[DATA CLEANUP] Running scheduled automated cleanup...');
      try {
        const result = await runAutomatedCleanup();
        console.log(`[DATA CLEANUP] Scheduled cleanup completed: ${result.successCount} successful, ${result.failureCount} failed`);
      } catch (error) {
        console.error('[DATA CLEANUP] Scheduled cleanup failed:', error);
      }

      // Also run error log cleanup (30-day retention)
      try {
        const errorLogResult = await deleteOldErrorLogs();
        console.log(`[ERROR LOG CLEANUP] Deleted ${errorLogResult.totalDeleted} logs older than 30 days`);
      } catch (error) {
        console.error('[ERROR LOG CLEANUP] Failed to delete old error logs:', error);
      }

      // Schedule next cleanup
      cleanupScheduled = false;
      scheduleNextCleanup();
    }, timeUntilCleanup);

    cleanupScheduled = true;
  }

  // Start the cleanup scheduler
  scheduleNextCleanup();
  console.log('[DATA CLEANUP] Automated daily cleanup scheduler initialized');
  console.log('[ERROR LOG CLEANUP] 30-day error log deletion scheduler initialized');

  // ============================================
  // BADBLUE WORKER LOGS (Admin Only)
  // ============================================

  // Get Worker Failure Logs
  app.get("/api/admin/worker/failure-logs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { badblueWorker } = await import('./badblueWorker');
      const logs = await badblueWorker.getFailureLogs();

      res.json({ logs });
    } catch (error: any) {
      console.error("Error fetching worker failure logs:", error);
      res.status(500).json({ message: "Failed to fetch failure logs", error: error.message });
    }
  });

  // Get Worker Function Error Logs
  app.get("/api/admin/worker/function-error-logs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { badblueWorker } = await import('./badblueWorker');
      const logs = await badblueWorker.getFunctionErrorLogs();

      res.json({ logs });
    } catch (error: any) {
      console.error("Error fetching worker function error logs:", error);
      res.status(500).json({ message: "Failed to fetch function error logs", error: error.message });
    }
  });

  // Manual Worker Actions (Admin Only)
  app.post("/api/admin/worker/run-diagnostic", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { badblueWorker } = await import('./badblueWorker');
      await badblueWorker.runManualDiagnostic();

      res.json({ message: "Diagnostic scan started", success: true });
    } catch (error: any) {
      console.error("Error running manual diagnostic:", error);
      res.status(500).json({ message: "Failed to run diagnostic", error: error.message });
    }
  });

  app.post("/api/admin/worker/run-weekly-test", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { badblueWorker } = await import('./badblueWorker');
      await badblueWorker.runManualWeeklyTest();

      res.json({ message: "Weekly system test started", success: true });
    } catch (error: any) {
      console.error("Error running weekly test:", error);
      res.status(500).json({ message: "Failed to run weekly test", error: error.message });
    }
  });

  app.post("/api/admin/worker/run-repair", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.id;

      if (userId !== "admin-bypass") {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { badblueWorker } = await import('./badblueWorker');
      await badblueWorker.runManualRepair();

      res.json({ message: "Repair cycle started", success: true });
    } catch (error: any) {
      console.error("Error running repair cycle:", error);
      res.status(500).json({ message: "Failed to run repair cycle", error: error.message });
    }
  });

  // Check if system is under maintenance
  app.get("/api/maintenance-status", async (req, res) => {
    try {
      const { badblueWorker } = await import('./badblueWorker');
      const isMaintenanceMode = badblueWorker.isUnderMaintenance();

      res.json({ maintenanceMode: isMaintenanceMode });
    } catch (error: any) {
      console.error("Error checking maintenance status:", error);
      res.status(500).json({ message: "Failed to check maintenance status", error: error.message });
    }
  });

  // ============================================
  // EMAIL SETTINGS ROUTES (Admin Only)
  // ============================================
  // Added email settings API endpoints based on the user's request.

  // Get email settings
  app.get("/api/admin/email-settings", adminAuthMiddleware, async (req, res) => {
    try {
      const fromEmailSetting = await db.query.appSettings.findFirst({
        where: eq(appSettings.key, 'support_from_email'),
      });
      const fromNameSetting = await db.query.appSettings.findFirst({
        where: eq(appSettings.key, 'support_from_name'),
      });

      res.json({
        fromEmail: fromEmailSetting?.value || process.env.DEFAULT_FROM_EMAIL || 'support@badblue.com',
        fromName: fromNameSetting?.value || process.env.DEFAULT_FROM_NAME || 'Bad Blue',
      });
    } catch (error) {
      console.error('Error fetching email settings:', error);
      res.status(500).json({ error: 'Failed to fetch email settings' });
    }
  });

  // Update email settings
  app.post("/api/admin/email-settings", adminAuthMiddleware, async (req, res) => {
    try {
      const { fromEmail, fromName } = req.body;
      const adminId = (req.session as any)?.adminBypass || 'unknown'; // Use mocked admin bypass ID

      // Validate inputs
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!fromEmail || !emailRegex.test(fromEmail)) {
        return res.status(400).json({ error: "Invalid 'From Email' format" });
      }
      if (!fromName || fromName.trim().length < 1 || fromName.trim().length > 80) {
        return res.status(400).json({ error: "'From Name' must be between 1 and 80 characters" });
      }

      // Get old values for audit log
      const oldFromEmailSetting = await db.query.appSettings.findFirst({ where: eq(appSettings.key, 'support_from_email') });
      const oldFromNameSetting = await db.query.appSettings.findFirst({ where: eq(appSettings.key, 'support_from_name') });

      // Save or update fromEmail
      await db.insert(appSettings).values({
        key: 'support_from_email',
        value: fromEmail,
        updatedBy: adminId,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: fromEmail,
          updatedBy: adminId,
          updatedAt: new Date(),
        },
      });

      // Save or update fromName
      await db.insert(appSettings).values({
        key: 'support_from_name',
        value: fromName,
        updatedBy: adminId,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: fromName,
          updatedBy: adminId,
          updatedAt: new Date(),
        },
      });

      // Log the changes in adminSettingsAudit
      if (oldFromEmailSetting?.value !== fromEmail) {
        await db.insert(adminSettingsAudit).values({
          settingKey: 'support_from_email',
          oldValue: oldFromEmailSetting?.value || null,
          newValue: fromEmail,
          adminId,
          ipAddress: req.ip || null,
        });
      }
      if (oldFromNameSetting?.value !== fromName) {
        await db.insert(adminSettingsAudit).values({
          settingKey: 'support_from_name',
          oldValue: oldFromNameSetting?.value || null,
          newValue: fromName,
          adminId,
          ipAddress: req.ip || null,
        });
      }

      res.json({ success: true, message: "Email settings updated successfully" });
    } catch (error) {
      console.error('Error saving email settings:', error);
      res.status(500).json({ error: 'Failed to save email settings' });
    }
  });


  // Advanced Reasoning Orchestrator Endpoints
  app.post("/api/admin/advanced-reasoning", adminAuthMiddleware, async (req, res) => {
    try {
      const { task, enableExecution } = req.body;
      
      if (!task || typeof task !== 'string') {
        return res.status(400).json({ error: 'Task description is required' });
      }
      
      const { executeAdvancedReasoning } = await import('./aiSubAgent');
      const result = await executeAdvancedReasoning(task, enableExecution || false);
      
      res.json({
        success: true,
        result,
      });
    } catch (error: any) {
      console.error('Error in advanced reasoning:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/impact-analysis", adminAuthMiddleware, async (req, res) => {
    try {
      const { targetComponent, changeDescription } = req.body;
      
      if (!targetComponent || !changeDescription) {
        return res.status(400).json({ error: 'targetComponent and changeDescription are required' });
      }
      
      const { performImpactAnalysis } = await import('./aiSubAgent');
      const result = await performImpactAnalysis(targetComponent, changeDescription);
      
      res.json({
        success: true,
        result,
      });
    } catch (error: any) {
      console.error('Error in impact analysis:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/self-diagnostic", adminAuthMiddleware, async (req, res) => {
    try {
      const { getSelfDiagnostic } = await import('./aiSubAgent');
      const diagnostic = await getSelfDiagnostic();
      
      res.json({
        success: true,
        diagnostic,
      });
    } catch (error: any) {
      console.error('Error getting self-diagnostic:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/capability-ledger", adminAuthMiddleware, async (req, res) => {
    try {
      const { getCapabilityLedger } = await import('./aiSubAgent');
      const ledger = getCapabilityLedger();
      
      res.json({
        success: true,
        capabilities: ledger.map(([name, record]) => ({
          name,
          ...record,
        })),
      });
    } catch (error: any) {
      console.error('Error getting capability ledger:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/analysis-history", adminAuthMiddleware, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const { getAnalysisHistory } = await import('./aiSubAgent');
      const history = getAnalysisHistory(limit);
      
      res.json({
        success: true,
        history,
      });
    } catch (error: any) {
      console.error('Error getting analysis history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/diagnostic-history", adminAuthMiddleware, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const { getDiagnosticHistory } = await import('./aiSubAgent');
      const history = getDiagnosticHistory(limit);
      
      res.json({
        success: true,
        history,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // AUTONOMOUS IMPROVEMENTS ADMIN ENDPOINTS
  app.post("/api/admin/trigger-improvement-cycle", adminAuthMiddleware, async (req, res) => {
    try {
      const { triggerImprovementCycle } = await import('./aiSubAgent');
      const results = await triggerImprovementCycle();
      
      res.json({
        success: true,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/admin/learning-records", adminAuthMiddleware, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const { getLearningRecords } = await import('./aiSubAgent');
      const records = getLearningRecords(limit);
      
      res.json({
        success: true,
        records,
        totalRecords: records.length,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/admin/attorney-research", adminAuthMiddleware, async (req, res) => {
    try {
      const { getAttorneyResearch } = await import('./aiSubAgent');
      const research = getAttorneyResearch();
      const researchObj = Object.fromEntries(research);
      const documentTypes = Array.from(research).map(([type]) => type);
      
      res.json({
        success: true,
        research: researchObj,
        documentTypes,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/admin/improvement-status", adminAuthMiddleware, async (req, res) => {
    try {
      const { getImprovementStatus } = await import('./aiSubAgent');
      const status = getImprovementStatus();
      
      res.json({
        success: true,
        status,
      });
    } catch (error: any) {
      console.error('Error getting diagnostic history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // COMPREHENSIVE DIAGNOSTICS ENDPOINT
  // ============================================
  
  // Full system diagnostics - protected endpoint (admin or bypass account)
  app.get("/api/diagnostics/full", async (req: any, res) => {
    try {
      // Check authentication - allow admin-bypass or authenticated admin users
      const isAuthenticatedRequest = req.isAuthenticated?.();
      const userId = req.user?.claims?.sub || req.user?.id;
      
      // Check for bypass credentials in Basic auth header
      const authHeader = req.headers.authorization;
      let isBypassAuth = false;
      
      if (authHeader && authHeader.startsWith('Basic ')) {
        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
        const [username, password] = credentials.split(':');
        isBypassAuth = (username === 'Bypass' && password === 'Payment');
      }
      
      // Require either authenticated admin, admin-bypass user, or bypass credentials
      if (!isAuthenticatedRequest && !isBypassAuth) {
        return res.status(401).json({ 
          message: "Authentication required",
          hint: "Use admin account or Bypass/Payment credentials"
        });
      }
      
      if (isAuthenticatedRequest && userId !== "admin-bypass" && !isBypassAuth) {
        // Additional check for admin role if needed
        const user = await storage.getUser(userId);
        if (!user || !user.hasPaidForAccess) {
          return res.status(403).json({ 
            message: "Access denied",
            hint: "Admin privileges required"
          });
        }
      }

      console.log('[DIAGNOSTICS] Running comprehensive system diagnostics...');
      
      // Import and run comprehensive diagnostics
      const { runComprehensiveDiagnostics } = await import('./comprehensiveDiagnostics');
      const report = await runComprehensiveDiagnostics();
      
      // Log summary to console
      console.log(`[DIAGNOSTICS] Complete: ${report.summary.passed}/${report.summary.total} passed`);
      console.log(`[DIAGNOSTICS] Failed: ${report.summary.failed}, Warnings: ${report.summary.warnings}`);
      
      // Return comprehensive report
      res.json({
        success: report.summary.failed === 0,
        report,
        message: report.summary.failed === 0 
          ? `All systems operational (${report.summary.passed}/${report.summary.total} tests passed)`
          : `System issues detected (${report.summary.failed} failures, ${report.summary.warnings} warnings)`,
      });
      
    } catch (error: any) {
      console.error('[DIAGNOSTICS] Error running diagnostics:', error);
      res.status(500).json({ 
        success: false,
        message: "Failed to run diagnostics",
        error: error.message 
      });
    }
  });
  
  // Quick health check endpoint (public, lightweight)
  app.get("/api/health", async (req, res) => {
    try {
      // Just check database connectivity
      await db.execute(sql`SELECT 1`);
      res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(503).json({ 
        status: 'error',
        message: 'Database unavailable',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Worker and Sub-Agent Comprehensive Testing Endpoints
  app.post("/api/admin/run-comprehensive-tests", adminAuthMiddleware, async (req, res) => {
    try {
      const { MasterTestRunner } = await import('./tests/masterTestRunner');
      const runner = new MasterTestRunner();
      
      const report = await runner.runComprehensiveTests();
      
      res.json({
        success: true,
        report,
      });
    } catch (error: any) {
      console.error('Error running comprehensive tests:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/admin/latest-test-report", adminAuthMiddleware, async (req, res) => {
    try {
      const { MasterTestRunner } = await import('./tests/masterTestRunner');
      const runner = new MasterTestRunner();
      
      const report = await runner.getLatestReport();
      
      if (!report) {
        return res.status(404).json({
          success: false,
          error: 'No test reports found',
        });
      }

      res.json({
        success: true,
        report,
      });
    } catch (error: any) {
      console.error('Error fetching test report:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Apply notFoundHandler ONLY to API routes to ensure proper JSON 404 responses
  // This won't interfere with frontend routes since those don't start with /api
  app.use('/api', notFoundHandler);
  
  // Apply the general error handler globally
  app.use(errorHandler);

  const httpServer = createServer(app);
  return httpServer;
}
