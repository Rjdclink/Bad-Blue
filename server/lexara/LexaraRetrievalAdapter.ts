import {
  pantheonRetrievalAdapter,
  type PantheonRetrievalResponse,
  type RetrievalEvidence,
} from '../services/crawlers/PantheonRetrievalAdapter';

export const lexaraRetrievalAdapter = pantheonRetrievalAdapter;
export type LexaraRetrievalResponse = PantheonRetrievalResponse;
export type LexaraRetrievalEvidence = RetrievalEvidence;
