// Criminal Records Fusion - Deduplication and Merging
import type { CriminalRecord } from '../types';

export class CriminalRecordsFusion {
  static fuse(records: Partial<CriminalRecord>[]): CriminalRecord {
    if (records.length === 0) {
      throw new Error('No records to fuse');
    }

    // Initialize fused record with highest confidence source
    const sortedByConfidence = records.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    
    const fusedRecord: CriminalRecord = {
      fullName: sortedByConfidence[0].fullName || '',
      dateOfBirth: sortedByConfidence[0].dateOfBirth,
      charges: [],
      arrests: [],
      convictions: [],
      activeWarrants: [],
      sexOffenderStatus: { registered: false },
      incarcerationHistory: [],
      source: 'Fused from multiple sources',
      confidence: 0,
      scrapedAt: new Date(),
    };

    // Merge all records
    records.forEach(record => {
      if (record.charges) fusedRecord.charges.push(...record.charges);
      if (record.arrests) fusedRecord.arrests.push(...record.arrests);
      if (record.convictions) fusedRecord.convictions.push(...record.convictions);
      if (record.activeWarrants) fusedRecord.activeWarrants.push(...record.activeWarrants);
      if (record.incarcerationHistory) fusedRecord.incarcerationHistory.push(...record.incarcerationHistory);
      
      // Sex offender status - if any source shows registered, set to true
      if (record.sexOffenderStatus?.registered) {
        fusedRecord.sexOffenderStatus = record.sexOffenderStatus;
      }
    });

    // Deduplicate charges by statute and date
    fusedRecord.charges = this.deduplicateCharges(fusedRecord.charges);
    
    // Calculate average confidence
    const validConfidences = records.filter(r => r.confidence).map(r => r.confidence!);
    fusedRecord.confidence = validConfidences.length > 0
      ? validConfidences.reduce((a, b) => a + b, 0) / validConfidences.length
      : 0;

    return fusedRecord;
  }

  private static deduplicateCharges(charges: CriminalRecord['charges']): CriminalRecord['charges'] {
    const seen = new Set<string>();
    return charges.filter(charge => {
      const key = `${charge.statute}-${charge.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  static calculateRiskScore(record: CriminalRecord): number {
    let score = 0;
    
    // Sex offender = maximum risk
    if (record.sexOffenderStatus.registered) return 10;
    
    // Active warrants = high risk
    if (record.activeWarrants.length > 0) score += 8;
    
    // Violent felonies = high risk (from convictions)
    const violentFelonies = record.convictions.filter(c => 
      c.charge.match(/assault|battery|murder|rape|robbery/i)
    );
    score += violentFelonies.length * 3;
    
    // Other felonies = medium risk (from charges, excluding violent ones already counted)
    const otherFelonies = record.charges.filter(c => 
      c.degree === 'felony' && 
      !c.charge.match(/assault|battery|murder|rape|robbery/i)
    );
    score += otherFelonies.length * 2;
    
    // Misdemeanors = low risk
    score += record.charges.filter(c => c.degree === 'misdemeanor').length * 0.5;
    
    return Math.min(score, 10); // Cap at 10
  }
}
