// API Exports - Dashboard and Admin endpoints
import {dashboardApi, wss} from './dashboard-api';
import {adminApi} from './admin-api';

export {dashboardApi, adminApi, wss};

// Usage in main server:
// app.use('/api/crypto', dashboardApi);
// app.use('/admin/crypto', adminApi);
// server.on('upgrade', (request, socket, head) => {
//   wss.handleUpgrade(request, socket, head, (ws) => {
//     wss.emit('connection', ws, request);
//   });
// });
