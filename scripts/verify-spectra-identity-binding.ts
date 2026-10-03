import assert from 'node:assert/strict';
import {
  assessSpectraIdentityBinding,
  conservativeJointConfidence,
} from '../server/services/spectra/SpectraIdentityBinding';
import type { SpectraIdentityBindingEvidence } from '../server/services/spectra/SpectraAcquisitionPersistence';

const now = new Date('2026-10-02T21:30:00Z');

function evidence(
  providerKind: string,
  values: Record<string, number>,
  metadata: Record<string, unknown> = {},
  provider = 'carrier-network',
): SpectraIdentityBindingEvidence {
  return {
    provider,
    observedAt: now,
    values,
    metadata: {
      providerKind,
      ...metadata,
    },
  };
}

{
  const assessment = assessSpectraIdentityBinding({
    baselineIdentityConfidence: 0,
    targetIsPhone: true,
    evidence: [
      evidence(
        'camara-number-verification',
        { verified: 1 },
        { phoneNumber: '+16055551212' },
      ),
      evidence(
        'camara-device-identifier',
        { identifierPresent: 1 },
        {
          imei: '490154203237518',
          tac: '49015420',
        },
      ),
    ],
  });

  assert.equal(assessment.numberVerified, true);
  assert.equal(assessment.deviceIdentifierPresent, true);
  assert.equal(assessment.confidence, 1);
}

{
  const assessment = assessSpectraIdentityBinding({
    baselineIdentityConfidence: 0.82,
    targetIsPhone: false,
    evidence: [
      evidence(
        'camara-kyc-match',
        { matchScore: 0.997 },
        { bindingType: 'operator-kyc-match' },
        'carrier-kyc',
      ),
      evidence(
        'camara-number-verification',
        { verified: 1 },
      ),
    ],
  });

  assert.equal(assessment.numberVerified, true);
  assert.equal(assessment.operatorKycConfidence, 0.997);
  assert.equal(assessment.confidence, 0.997);

  const spatialConfidence = 0.9995;
  const joint = conservativeJointConfidence(
    assessment.confidence,
    spatialConfidence,
  );
  assert.ok(joint > 0.99);
  assert.ok(joint <= Math.min(assessment.confidence, spatialConfidence));
}

{
  const assessment = assessSpectraIdentityBinding({
    baselineIdentityConfidence: 0.96,
    targetIsPhone: false,
    evidence: [
      evidence(
        'camara-number-verification',
        { verified: 0 },
      ),
    ],
  });

  assert.equal(assessment.numberVerified, false);
  assert.ok(assessment.confidence < 0.96);
  assert.ok(assessment.contradictions.length > 0);
}

{
  const joint = conservativeJointConfidence(0.8, 0.9);
  assert.equal(joint, 0.7);
}

console.log('SPECTRA identity-binding regression checks passed.');
