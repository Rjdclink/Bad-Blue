Warning: truncated output (original token count: 5850)
Total output lines: 469

import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';

interface SourceEntry {
  name?: string;
  confidence?: number;
  timestamp?: Date | string;
  data?: unknown;
}

interface…5750 tokens truncated…N   |   Report ${input.reportId.slice(0, 8)}   |   Page ${index + 1} of ${pageRange.count}`,
        48, 684, { width: 516, align: 'center', lineBreak: false },
      );
    }

    doc.end();
  });
}
