import levenshtein from 'fast-levenshtein';

interface MatchResult {
  score: number;
  distance: number;
  isMatch: boolean;
}

export class FuzzyMatcher {
  private readonly thresholds = {
    high: 0.85,    // 85% similarity
    medium: 0.70,  // 70% similarity
    low: 0.50,     // 50% similarity
  };

  normalize(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  calculateSimilarity(str1: string, str2: string): number {
    const distance = levenshtein.get(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;
    return (maxLength - distance) / maxLength;
  }

  match(str1: string, str2: string, threshold: 'high' | 'medium' | 'low' = 'medium'): MatchResult {
    const normalized1 = this.normalize(str1);
    const normalized2 = this.normalize(str2);
    const similarity = this.calculateSimilarity(normalized1, normalized2);
    const distance = levenshtein.get(normalized1, normalized2);

    return {
      score: Math.round(similarity * 100),
      distance,
      isMatch: similarity >= this.thresholds[threshold],
    };
  }

  findBestMatch(target: string, candidates: string[]): {
    bestMatch: string | null;
    score: number;
    allScores: Array<{ candidate: string; score: number }>;
  } {
    const normalized = this.normalize(target);
    const scores = candidates.map(candidate => ({
      candidate,
      score: Math.round(this.calculateSimilarity(normalized, this.normalize(candidate)) * 100),
    }));

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];

    return {
      bestMatch: best && best.score >= 50 ? best.candidate : null,
      score: best ? best.score : 0,
      allScores: scores,
    };
  }

  matchName(name1: string, name2: string): MatchResult {
    const parts1 = name1.split(' ').filter(p => p);
    const parts2 = name2.split(' ').filter(p => p);

    const variations = [
      name1,
      parts1.reverse().join(' '),
      parts1.length >= 2 ? `${parts1[0]} ${parts1[parts1.length - 1]}` : name1,
    ];

    const results = variations.map(v => this.match(v, name2));
    results.sort((a, b) => b.score - a.score);
    
    return results[0];
  }
}

export const fuzzyMatcher = new FuzzyMatcher();
