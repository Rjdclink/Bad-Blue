import type { SpectraIdentityBindingEvidence } from './SpectraAcquisitionPersistence';

export interface SpectraIdentityBindingAssessment {
  confidence: number;
  baselineIdentityConfidence: number;
  operatorKycConfidence?: number;
  numberVerified?: boolean;
  deviceIdentifierPresent: boolean;
  deviceIdentifier?: {
    imei?: string;
    imeiSv?: string;
    tac?: string;
    manufacturer?: string;
    model?: string;
  };
  evidenceCount: number;
  providers: string[];
  contradictions: string[];
  reasons: string[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function conservativeJointConfidence(
  firstProbability: number,
  secondProbability: number,
): number {
  const first = clamp(firstProbability);
  const second = clamp(secondProbability);
  // Fréchet-Hoeffding lower bound: P(A∩B) >= max(0, P(A)+P(B)-1).
  // This avoids assuming identity and spatial errors are independent.
  return clamp(first + second - 1);
}

function metadataKind(evidence: SpectraIdentityBindingEvidence): string {
  return String(evidence.metadata.providerKind || '').trim().toLowerCase();
}

export function assessSpectraIdentityBinding(input: {
  baselineIdentityConfidence: number;
  targetIsPhone: boolean;
  evidence: SpectraIdentityBindingEvidence[];
}): SpectraIdentityBindingAssessment {
  const baselineIdentityConfidence = clamp(input.baselineIdentityConfidence);
  let numberVerified: boolean | undefined;
  let operatorKycConfidence: number | undefined;
  let deviceIdentifierPresent = false;
  let deviceIdentifier: SpectraIdentityBindingAssessment['deviceIdentifier'];
  const providers = new Set<string>();
  const contradictions: string[] = [];
  const reasons: string[] = [];

  const evidence = [...input.evidence]
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());

  for (const item of evidence) {
    if (item.provider) providers.add(item.provider);
    const kind = metadataKind(item);

    if (kind === 'camara-number-verification' && numberVerified === undefined) {
      const verified = Number(item.values.verified);
      if (verified === 1) numberVerified = true;
      else if (verified === 0) numberVerified = false;
    }

    if (kind === 'camara-kyc-match') {
      const score = Number(item.values.matchScore);
      if (Number.isFinite(score) && score >= 0 && score <= 1) {
        operatorKycConfidence = operatorKycConfidence === undefined
          ? score
          : Math.max(operatorKycConfidence, score);
      }
    }

    if (kind === 'camara-device-identifier' && !deviceIdentifierPresent) {
      const present = Number(item.values.identifierPresent);
      deviceIdentifierPresent = present === 1;
      if (deviceIdentifierPresent) {
        deviceIdentifier = {
          imei: typeof item.metadata.imei === 'string'
            ? item.metadata.imei
            : undefined,
          imeiSv: typeof item.metadata.imeiSv === 'string'
            ? item.metadata.imeiSv
            : undefined,
          tac: typeof item.metadata.tac === 'string'
            ? item.metadata.tac
            : undefined,
          manufacturer: typeof item.metadata.manufacturer === 'string'
            ? item.metadata.manufacturer
            : undefined,
          model: typeof item.metadata.model === 'string'
            ? item.metadata.model
            : undefined,
        };
      }
    }
  }

  if (numberVerified === false) {
    contradictions.push('The network number-verification result contradicts the target phone binding.');
  }

  let confidence = baselineIdentityConfidence;

  if (input.targetIsPhone) {
    // When the requested subject is the subscription/phone itself, a positive
    // network number-verification result establishes the target binding.
    if (numberVerified === true && baselineIdentityConfidence === 0) {
      // For a phone/subscription target, network verification establishes that
      // the telemetry is bound to the requested subscription. This is a
      // categorical binding, not a fabricated probabilistic score.
      confidence = 1;
    }
    if (numberVerified === false) confidence = 0;
  } else {
    // For a named person, operator KYC is direct identity evidence. Prefer the
    // strongest explicit KYC match without multiplying potentially correlated
    // identity estimators.
    if (operatorKycConfidence !== undefined) {
      confidence = Math.max(confidence, operatorKycConfidence);
    }
    if (numberVerified === false) {
      confidence *= 0.25;
    }
  }

  if (numberVerified === true) {
    reasons.push('The network verified the target phone-number binding.');
  }
  if (operatorKycConfidence !== undefined) {
    reasons.push('Operator KYC match evidence contributes to subject identity confidence.');
  }
  if (deviceIdentifierPresent) {
    reasons.push('The network returned a physical device identifier bound to the subscriber context.');
  }

  return {
    confidence: clamp(confidence),
    baselineIdentityConfidence,
    operatorKycConfidence,
    numberVerified,
    deviceIdentifierPresent,
    deviceIdentifier,
    evidenceCount: evidence.length,
    providers: [...providers],
    contradictions,
    reasons,
  };
}
