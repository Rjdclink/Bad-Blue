// API Exports - Dashboard and Admin endpoints
import { Router } from 'express';
import {dashboardApi, wss} from './dashboard-api';
import {adminApi as legacyAdminApi} from './admin-api';
import { truthfulAdminDiagnostics } from './truthful-admin-diagnostics.js';

// The diagnostics router intentionally comes first so legacy decorative
// /health, /logs and /config handlers cannot answer requests. All other legacy
// governance/control routes continue unchanged behind it.
const adminApi = Router();
adminApi.use(truthfulAdminDiagnostics);
adminApi.use(legacyAdminApi);

export {dashboardApi, adminApi, wss};

// Usage in main server:
// app.use('/api/crypto', dashboardApi);
// app.use('/admin/crypto', adminApi);
// server.on('upgrade', (request, socket, head) => {
//   wss.handleUpgrade(request, socket, head, (ws) => {
//     wss.emit('connection', ws, request);
//   });
// });
