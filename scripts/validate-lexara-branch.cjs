const fs = require('fs');
const path = require('path');

const requiredFiles = [
  'client/src/components/LexaraConversation.tsx',
  'client/src/components/LexaraCaseTools.tsx',
  'client/src/hooks/useVoiceMode.ts',
  'client/src/hooks/useVoiceSynthesis.ts',
  'client/src/lib/lexaraSpeechClient.ts',
  'client/src/pages/legal-consultation.tsx',
  'server/lexara/LexaraConversationOrchestrator.ts',
  'server/lexara/LexaraAuthorityResearch.ts',
  'server/lexara/LexaraMediaExtraction.ts',
  'server/routes/lexara.chat.routes.ts',
  'server/routes/consultation.routes.ts',
  'server/routes/fmi.routes.ts',
  'shared/legalDomainMapping.ts',
];

const forbiddenPatterns = [
  [/railway\s+ai\s+agent/i, 'Railway AI agent reference'],
  [/https:\/\/example\.com\/legal-consultation/i, 'placeholder canonical URL'],
  [/you are a highly experienced legal expert.*years of practice/is, 'synthetic years-of-practice claim'],
];

let failed = false;
for (const file of requiredFiles) {
  const absolute = path.resolve(process.cwd(), file);
  if (!fs.existsSync(absolute)) {
    console.error(`[LEXARA VALIDATE] Missing required file: ${file}`);
    failed = true;
    continue;
  }
  const text = fs.readFileSync(absolute, 'utf8');
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(text) && label !== 'Railway AI agent reference') {
      console.error(`[LEXARA VALIDATE] Forbidden ${label} in ${file}`);
      failed = true;
    }
  }
}

const railwayDirective = path.resolve(process.cwd(), '.github/instructions/railway-operations.instructions.md');
if (!fs.existsSync(railwayDirective) || !/never use railway'?s? ai agent/i.test(fs.readFileSync(railwayDirective, 'utf8'))) {
  console.error('[LEXARA VALIDATE] Railway AI-agent prohibition directive is missing');
  failed = true;
}

if (failed) process.exit(1);
console.log('[LEXARA VALIDATE] Static invariant gate passed. Run npm run check and npm run build before merge.');
