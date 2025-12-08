// WebSocket connection
let ws;
let reconnectInterval;

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/api/crypto/live`);
  
  ws.onopen = () => {
    console.log('✅ Connected to CryptoCrawl');
    document.getElementById('statusDot').style.background = '#22c55e';
    clearInterval(reconnectInterval);
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'stats') {
      updateStats(data.data);
    } else if (data.type === 'update') {
      updateStats(data.data.stats);
    } else if (data.type === 'opportunity') {
      addOpportunity(data.data);
    } else if (data.type === 'trade') {
      addTrade(data.data);
    }
  };
  
  ws.onclose = () => {
    console.log('❌ Disconnected, reconnecting...');
    document.getElementById('statusDot').style.background = '#ef4444';
    reconnectInterval = setInterval(connect, 5000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

// Update statistics
function updateStats(stats) {
  const profit = stats.totalProfit || 0;
  const successRate = (stats.successRate * 100) || 0;
  const trades = stats.totalTrades || 0;
  const avgProfit = trades > 0 ? (profit / trades) : 0;
  
  document.getElementById('profit24h').textContent = `$${profit.toFixed(2)}`;
  document.getElementById('successRate').textContent = `${successRate.toFixed(1)}%`;
  document.getElementById('trades24h').textContent = trades;
  document.getElementById('avgProfit').textContent = `$${avgProfit.toFixed(2)}`;
  
  // Update changes (mock for now)
  document.getElementById('profitChange').textContent = '+12.5%';
  document.getElementById('successChange').textContent = `${stats.successfulTrades}/${stats.totalTrades}`;
  
  updateChart();
}

// Update profit chart
let chartData = Array(24).fill(0);
function updateChart() {
  const chart = document.getElementById('profitChart');
  
  // Shift data and add new value
  chartData.shift();
  chartData.push(Math.random() * 100 + 50);
  
  const max = Math.max(...chartData);
  
  chart.innerHTML = chartData.map(value => 
    `<div class="chart-bar" style="height: ${(value / max) * 100}%"></div>`
  ).join('');
}

// Add live opportunity
function addOpportunity(opp) {
  const container = document.getElementById('opportunities');
  const isHigh = opp.profit > 100;
  
  const el = document.createElement('div');
  el.className = `opportunity ${isHigh ? 'high' : ''}`;
  el.innerHTML = `
    <div class="opportunity-info">
      <div class="opportunity-asset">${opp.asset}</div>
      <div class="opportunity-meta">${opp.chain} • ${opp.tier} • ${(opp.successProbability * 100).toFixed(1)}%</div>
    </div>
    <div class="opportunity-profit">$${opp.profit.toFixed(2)}</div>
  `;
  
  container.insertBefore(el, container.firstChild);
  
  // Keep only last 10
  while (container.children.length > 10) {
    container.removeChild(container.lastChild);
  }
  
  // Update count
  document.getElementById('oppCount').textContent = `${container.children.length} active`;
}

// Add recent trade
function addTrade(trade) {
  const container = document.getElementById('recentTrades');
  
  const el = document.createElement('div');
  el.className = 'trade';
  el.innerHTML = `
    <div>
      <strong>${trade.asset}</strong>
      <div class="trade-time">${new Date(trade.timestamp).toLocaleTimeString()}</div>
    </div>
    <div class="${trade.success ? 'trade-success' : 'trade-fail'}">
      ${trade.success ? '✓' : '✗'} $${trade.profit.toFixed(2)}
    </div>
  `;
  
  container.insertBefore(el, container.firstChild);
  
  // Keep only last 20
  while (container.children.length > 20) {
    container.removeChild(container.lastChild);
  }
}

// System controls
async function toggleSystem() {
  try {
    const response = await fetch('/admin/crypto/start', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('adminToken') || ''}`,
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    showNotification(result.message || 'System toggled', response.ok ? 'success' : 'error');
  } catch (error) {
    showNotification('Failed to toggle system', 'error');
  }
}

async function emergencyStop() {
  if (!confirm('Emergency stop will halt all operations. Continue?')) return;
  
  try {
    const response = await fetch('/admin/crypto/stop', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('adminToken') || ''}`,
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    showNotification(result.message || 'Emergency stop executed', response.ok ? 'success' : 'error');
    if (response.ok) {
      document.getElementById('statusText').textContent = 'Stopped';
      document.getElementById('statusDot').style.background = '#ef4444';
    }
  } catch (error) {
    showNotification('Failed to execute emergency stop', 'error');
  }
}

// Simple notification system
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'};
    color: white;
    border-radius: 8px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Load initial data
async function loadInitialData() {
  try {
    const response = await fetch('/api/crypto/stats');
    const stats = await response.json();
    
    updateStats({
      totalProfit: stats.profit.today,
      totalTrades: stats.trades.total,
      successfulTrades: stats.trades.successful,
      successRate: parseFloat(stats.trades.successRate) / 100
    });
    
    // Load opportunities
    const oppResponse = await fetch('/api/crypto/opportunities');
    const opportunities = await oppResponse.json();
    opportunities.opportunities.forEach(addOpportunity);
    
  } catch (error) {
    console.error('Failed to load initial data:', error);
  }
}

// Initialize
connect();
loadInitialData();
setInterval(updateChart, 5000);

// Mock data for testing - only enabled if MOCK_DATA is set in localStorage
const enableMockData = localStorage.getItem('MOCK_DATA') === 'true';

if (enableMockData) {
  console.log('🎭 Mock data enabled for testing');
  
  setInterval(() => {
    if (Math.random() > 0.7) {
      addOpportunity({
        asset: 'USDC/USDT',
        chain: 'polygon',
        profit: Math.random() * 200 + 20,
        tier: 'SAFE',
        successProbability: 0.85 + Math.random() * 0.1
      });
    }
    
    if (Math.random() > 0.8) {
      addTrade({
        asset: 'WETH/MATIC',
        timestamp: Date.now(),
        success: Math.random() > 0.2,
        profit: Math.random() * 150 + 10
      });
    }
  }, 3000);
}
