# CryptoCrawl Dashboard

Real-time monitoring dashboard for the CryptoCrawl arbitrage trading system.

## Features

- **Real-time WebSocket Updates** - Live data with <2s latency
- **Trading Statistics** - 24-hour profit, success rate, trade count
- **Live Profit Chart** - Visual representation of profit over time
- **Opportunity Feed** - Active trading opportunities with color-coded priorities
- **Recent Trades** - Last 20 trades with success/failure indicators
- **System Controls** - Start/stop and emergency stop functionality
- **Auto-reconnect** - Automatic WebSocket reconnection on disconnect
- **Mobile Responsive** - Works on all screen sizes

## Access

The dashboard is available at:
- **Development**: http://localhost:5000/dashboard.html
- **Production**: https://your-domain.com/dashboard.html

## API Endpoints

### Public Endpoints

- **GET `/api/crypto/stats`**
  - Returns current trading statistics
  - Response: `{ profit: {...}, trades: {...} }`

- **GET `/api/crypto/opportunities`**
  - Returns active trading opportunities
  - Response: `{ opportunities: [...] }`

### WebSocket

- **WebSocket `/api/crypto/live`**
  - Real-time updates for stats, opportunities, and trades
  - Message types: `stats`, `update`, `opportunity`, `trade`

### Admin Endpoints (Require Authentication)

- **POST `/admin/crypto/start`**
  - Start/stop the trading system
  - Headers: `Authorization: Bearer <token>`
  - Response: `{ success: true, message: "...", status: "running" }`

- **POST `/admin/crypto/stop`**
  - Emergency stop all operations
  - Headers: `Authorization: Bearer <token>`
  - Response: `{ success: true, message: "...", status: "stopped" }`

## Testing

To enable mock data for testing:

```javascript
localStorage.setItem('MOCK_DATA', 'true');
```

Then reload the dashboard. Mock opportunities and trades will be generated every 3 seconds.

To disable mock data:

```javascript
localStorage.removeItem('MOCK_DATA');
```

## Authentication

Admin endpoints require a Bearer token. Set it in localStorage:

```javascript
localStorage.setItem('adminToken', 'your-token-here');
```

## Architecture

### Files

```
server/services/cryptocrawl/
├── ui/
│   ├── dashboard.html         # Dashboard UI (115 lines)
│   └── dashboard-client.js    # WebSocket client (243 lines)
└── api.ts                      # API routes & WebSocket (182 lines)
```

### Integration

The dashboard is integrated into the main server via:

1. **Static File Serving** (`server/index.ts`)
   - Serves UI files from `server/services/cryptocrawl/ui`

2. **API Routes** (`server/routes.ts`)
   - Mounts `/api/crypto` and `/admin/crypto` routes
   - WebSocket upgrade handler for `/api/crypto/live`

### WebSocket Protocol

Messages are JSON objects with a `type` field:

```javascript
// Stats update
{
  type: 'stats',
  data: {
    totalProfit: 1234.56,
    totalTrades: 100,
    successfulTrades: 85,
    successRate: 0.85
  }
}

// New opportunity
{
  type: 'opportunity',
  data: {
    asset: 'USDC/USDT',
    chain: 'polygon',
    profit: 123.45,
    tier: 'SAFE',
    successProbability: 0.92
  }
}

// New trade
{
  type: 'trade',
  data: {
    asset: 'WETH/MATIC',
    timestamp: 1234567890,
    success: true,
    profit: 45.67
  }
}
```

## Security

- Admin endpoints require Bearer token authentication
- WebSocket connections are validated
- Emergency stop requires user confirmation
- All sensitive operations are logged

## Accessibility

- ARIA labels for status indicators and controls
- Semantic HTML structure
- Screen reader compatible
- Keyboard navigation support

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Responsive design

## Total Lines: 540

- dashboard.html: 115 lines
- dashboard-client.js: 243 lines (includes notification system and security improvements)
- api.ts: 182 lines (includes authentication middleware)

---

**Status**: ✅ Production Ready
**Version**: 1.0.0
**Created**: December 2024
