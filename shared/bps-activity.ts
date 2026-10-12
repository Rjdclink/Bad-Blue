export interface BpsActivityRow {
  sequence: number;
  observedAt: number;
  opportunityId: string;
  asset: string;
  beforeBps: number;
  afterBps: number;
  stage: 'resident' | 'requote';
  improved: boolean;
}

export interface BpsActivitySnapshot {
  rows: BpsActivityRow[];
  capacity: number;
  running: boolean;
}
