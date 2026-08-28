// API Exports - canonical CryptoCrawler dashboard + governed admin control.
import { Router } from 'express';
import { dashboardApi, wss } from './canonical-dashboard-api.js';
import { adminApi as legacyAdminApi } from './admin-api';
import { truthfulAdminDiagnostics } from './truthful-admin-diagnostics.js';

// Truthful diagnostics intentionally come first so stale decorative health/log/config
// handlers cannot answer requests. Remaining admin controls stay behind their existing
// authentication and governance boundaries while the dashboard itself has no startup,
// optimizer, wallet-withdrawal, or synthetic execution side effects.
const adminApi = Router();
adminApi.use(truthfulAdminDiagnostics);
adminApi.use(legacyAdminApi);

export { dashboardApi, adminApi, wss };
