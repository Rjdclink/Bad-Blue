type AcquisitionOutcome = 'success' | 'error' | 'stopped' | 'busy';

interface CounterState {
  acquisitions: Record<AcquisitionOutcome, number>;
  acquisitionDurationMsTotal: number;
  acquisitionDurationCount: number;
  activeAcquisitions: number;
  resourceRejections: number;
  providerEvents: number;
  providerMeasurements: number;
  lastAcquisitionAt?: string;
  lastProviderEventAt?: string;
}

const state: CounterState = {
  acquisitions: {
    success: 0,
    error: 0,
    stopped: 0,
    busy: 0,
  },
  acquisitionDurationMsTotal: 0,
  acquisitionDurationCount: 0,
  activeAcquisitions: 0,
  resourceRejections: 0,
  providerEvents: 0,
  providerMeasurements: 0,
};

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function spectraMetricsAcquisitionStarted(): () => void {
  state.activeAcquisitions += 1;
  const startedAt = Date.now();
  let finished = false;

  return () => {
    if (finished) return;
    finished = true;
    state.activeAcquisitions = Math.max(0, state.activeAcquisitions - 1);
    const elapsed = Math.max(0, Date.now() - startedAt);
    state.acquisitionDurationMsTotal += elapsed;
    state.acquisitionDurationCount += 1;
    state.lastAcquisitionAt = new Date().toISOString();
  };
}

export function spectraMetricsAcquisitionOutcome(outcome: AcquisitionOutcome): void {
  state.acquisitions[outcome] += 1;
  if (outcome === 'busy') state.resourceRejections += 1;
}

export function spectraMetricsProviderEvent(measurementCount: number): void {
  state.providerEvents += 1;
  state.providerMeasurements += Math.max(0, Math.floor(measurementCount));
  state.lastProviderEventAt = new Date().toISOString();
}

export function getSpectraMetricsSnapshot() {
  return {
    ...state,
    acquisitions: { ...state.acquisitions },
  };
}

export function renderSpectraPrometheusMetrics(extra?: {
  apiVersion?: string;
  schemaVersion?: string;
  governor?: {
    globalLimit?: number;
    perTenantLimit?: number;
    localActive?: number;
    localQueued?: number;
    rejected?: number;
  };
}): string {
  const lines = [
    '# HELP spectra_acquisitions_total Completed SPECTRA acquisition requests by outcome.',
    '# TYPE spectra_acquisitions_total counter',
    ...Object.entries(state.acquisitions).map(([outcome, count]) =>
      `spectra_acquisitions_total{outcome="${escapeLabel(outcome)}"} ${count}`
    ),
    '# HELP spectra_acquisition_active Current active SPECTRA acquisition requests.',
    '# TYPE spectra_acquisition_active gauge',
    `spectra_acquisition_active ${state.activeAcquisitions}`,
    '# HELP spectra_acquisition_duration_milliseconds_total Total milliseconds spent in completed SPECTRA acquisitions.',
    '# TYPE spectra_acquisition_duration_milliseconds_total counter',
    `spectra_acquisition_duration_milliseconds_total ${state.acquisitionDurationMsTotal}`,
    '# HELP spectra_acquisition_duration_milliseconds_count Number of completed SPECTRA acquisition duration samples.',
    '# TYPE spectra_acquisition_duration_milliseconds_count counter',
    `spectra_acquisition_duration_milliseconds_count ${state.acquisitionDurationCount}`,
    '# HELP spectra_resource_rejections_total SPECTRA requests rejected by resource governance.',
    '# TYPE spectra_resource_rejections_total counter',
    `spectra_resource_rejections_total ${state.resourceRejections}`,
    '# HELP spectra_provider_events_total Provider telemetry events accepted by SPECTRA.',
    '# TYPE spectra_provider_events_total counter',
    `spectra_provider_events_total ${state.providerEvents}`,
    '# HELP spectra_provider_measurements_total Provider measurements accepted by SPECTRA.',
    '# TYPE spectra_provider_measurements_total counter',
    `spectra_provider_measurements_total ${state.providerMeasurements}`,
  ];

  if (extra?.governor) {
    lines.push(
      '# HELP spectra_governor_global_limit Configured cross-replica acquisition concurrency limit.',
      '# TYPE spectra_governor_global_limit gauge',
      `spectra_governor_global_limit ${Number(extra.governor.globalLimit || 0)}`,
      '# HELP spectra_governor_per_tenant_limit Configured per-tenant acquisition concurrency limit.',
      '# TYPE spectra_governor_per_tenant_limit gauge',
      `spectra_governor_per_tenant_limit ${Number(extra.governor.perTenantLimit || 0)}`,
      '# HELP spectra_governor_local_active Active fallback permits in this process.',
      '# TYPE spectra_governor_local_active gauge',
      `spectra_governor_local_active ${Number(extra.governor.localActive || 0)}`,
      '# HELP spectra_governor_local_queued Requests waiting for a SPECTRA resource permit.',
      '# TYPE spectra_governor_local_queued gauge',
      `spectra_governor_local_queued ${Number(extra.governor.localQueued || 0)}`,
      '# HELP spectra_governor_rejected_total Requests rejected after the bounded resource wait.',
      '# TYPE spectra_governor_rejected_total counter',
      `spectra_governor_rejected_total ${Number(extra.governor.rejected || 0)}`,
    );
  }

  if (extra?.apiVersion || extra?.schemaVersion) {
    lines.push(
      '# HELP spectra_build_info SPECTRA API/schema version information.',
      '# TYPE spectra_build_info gauge',
      `spectra_build_info{api_version="${escapeLabel(extra.apiVersion || '')}",schema_version="${escapeLabel(extra.schemaVersion || '')}"} 1`,
    );
  }

  return lines.join('\n') + '\n';
}
