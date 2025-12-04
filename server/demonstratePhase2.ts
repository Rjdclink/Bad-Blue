import { fuzzyMatcher } from './services/fuzzyMatch';
import { entityResolver } from './services/entityResolver';

/**
 * DEMONSTRATION: Phase 2 Fuzzy String Matching & Entity Resolution
 * 
 * This script demonstrates the new fuzzy matching and entity resolution features.
 */

async function demonstrateFuzzyMatching() {
  console.log('='.repeat(80));
  console.log('PHASE 2: FUZZY STRING MATCHING & ENTITY RESOLUTION DEMONSTRATION');
  console.log('='.repeat(80));
  console.log();

  // Example 1: Simple fuzzy matching
  console.log('1. BASIC FUZZY MATCHING');
  console.log('-'.repeat(80));
  const name1 = 'John Smith';
  const name2 = 'Jon Smyth';
  const match = fuzzyMatcher.match(name1, name2);
  console.log(`Comparing: "${name1}" vs "${name2}"`);
  console.log(`Similarity Score: ${match.score}%`);
  console.log(`Levenshtein Distance: ${match.distance}`);
  console.log(`Match Result: ${match.isMatch ? '✓ MATCH' : '✗ NO MATCH'}`);
  console.log();

  // Example 2: Name variations
  console.log('2. NAME VARIATION MATCHING');
  console.log('-'.repeat(80));
  const fullName = 'John Michael Smith';
  const reversedName = 'Smith John Michael';
  const nameMatch = fuzzyMatcher.matchName(fullName, reversedName);
  console.log(`Original: "${fullName}"`);
  console.log(`Reversed: "${reversedName}"`);
  console.log(`Similarity Score: ${nameMatch.score}%`);
  console.log(`Match Result: ${nameMatch.isMatch ? '✓ MATCH' : '✗ NO MATCH'}`);
  console.log();

  // Example 3: Finding best match from candidates
  console.log('3. BEST MATCH FROM CANDIDATES');
  console.log('-'.repeat(80));
  const target = 'Jennifer Anderson';
  const candidates = [
    'Jennifer Andrews',
    'Jane Anderson',
    'Jennifer Andersen',
    'Jessica Anderson',
  ];
  const bestMatch = fuzzyMatcher.findBestMatch(target, candidates);
  console.log(`Target: "${target}"`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Best Match: "${bestMatch.bestMatch}" (Score: ${bestMatch.score}%)`);
  console.log('\nAll Scores:');
  bestMatch.allScores.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.candidate.padEnd(20)} - ${s.score}%`);
  });
  console.log();

  // Example 4: Entity Resolution
  console.log('4. ENTITY RESOLUTION ACROSS SOURCES');
  console.log('-'.repeat(80));
  const records = [
    { name: 'Officer John Smith', email: 'jsmith@pd.gov', badge: 'B-1234', source: 'Police Database' },
    { name: 'John M. Smith', phone: '555-0100', source: 'Public Directory' },
    { name: 'Jon Smith', email: 'johnsmith@email.com', source: 'Social Media' },
    { name: 'J. Smith', phone: '555-0101', source: 'Court Records' },
  ];

  const resolved = await entityResolver.resolvePerson('John Smith', records);
  console.log(`Target Name: "John Smith"`);
  console.log(`\nResolved Entity:`);
  console.log(`  Primary Name: ${resolved.primaryName}`);
  console.log(`  Confidence: ${resolved.entity.confidence}%`);
  console.log(`  All Names Found: ${resolved.entity.names.length}`);
  resolved.entity.names.forEach((n, i) => {
    console.log(`    ${i + 1}. ${n}`);
  });
  console.log(`  Emails: ${resolved.entity.emails.join(', ') || 'None'}`);
  console.log(`  Phones: ${resolved.entity.phones.join(', ') || 'None'}`);
  console.log(`  Badges: ${resolved.entity.badges.join(', ') || 'None'}`);
  console.log(`  Sources: ${resolved.entity.sources.length}`);
  resolved.entity.sources.forEach((s, i) => {
    console.log(`    ${i + 1}. ${s}`);
  });
  console.log();

  // Example 5: Handling typos and misspellings
  console.log('5. TYPO AND MISSPELLING TOLERANCE');
  console.log('-'.repeat(80));
  const correctName = 'Christopher Rodriguez';
  const typos = [
    'Cristopher Rodriguez',  // Missing 'h'
    'Christopher Rodriquez', // 'g' -> 'q'
    'Christofer Rodriguez',  // Missing 'ph'
    'Christopher Rodrigez',  // Missing 'u'
  ];
  
  console.log(`Correct Name: "${correctName}"\n`);
  typos.forEach((typo, i) => {
    const result = fuzzyMatcher.match(correctName, typo);
    console.log(`${i + 1}. "${typo}"`);
    console.log(`   Score: ${result.score}% | Match: ${result.isMatch ? '✓' : '✗'}`);
  });
  console.log();

  console.log('='.repeat(80));
  console.log('DEMONSTRATION COMPLETE');
  console.log('='.repeat(80));
}

// Run demonstration
demonstrateFuzzyMatching().catch(console.error);
