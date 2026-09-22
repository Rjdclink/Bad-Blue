Warning: truncated output (original token count: 22020)
Total output lines: 1870

import { createHash } from 'node:crypto';
import type { PeopleSearchReport } from '../../peopleSearch';
import {
  getPantheonCategoryCapabilities,
  getPantheonPrimaryCrawlerCapabilitiesForCategory,
…21920 tokens truncated…t, ordered, baseReport, initialCategoryOutcomes);
    return { report, categoryOutcomes: mergePantheonCategoryOutcomes(initialCategoryOutcomes, ordered) };
  } finally {
    deadline.dispose();
  }
}
