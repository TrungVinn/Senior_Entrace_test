/**
 * API client for the Go backend.
 * Vite proxies /api → http://127.0.0.1:8080
 */

const BASE = '/api';

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Unknown API error');
  return json.data as T;
}

// --- Types ---

export interface MarketOverviewItem {
  symbol: string;
  timestamp: string;
  close: number;
  volume: number;
  sma7: number | null;
  rsi14: number | null;
}

export interface Kline {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma7: number | null;
  sma25: number | null;
  sma99: number | null;
  rsi14: number | null;
  volatility20: number | null;
  vwap: number | null;
}

export interface AISignal {
  symbol: string;
  timestamp: string;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  score: number;
  rsiComponent: number;
  smaComponent: number;
  volumeComponent: number;
}

export interface AnomalyItem {
  symbol: string;
  timestamp: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  zscore: number;
  description: string;
}

export interface MarketRegimeItem {
  symbol: string;
  timestamp: string;
  regime: string;
  confidence: number;
  volatilityValue: number;
}

export interface PortfolioSummary {
  totalValue: number;
  todayGain: number;
  todayGainPct: number;
  totalReturn: number;
  totalReturnPct: number;
  activePositions: number;
  totalInvested: number;
}

export interface Position {
  id: number;
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitLossPct: number;
}

// --- API functions ---

export const api = {
  getMarketOverview: () => fetchJSON<MarketOverviewItem[]>('/v1/market/overview'),
  getKlines: (symbol: string, limit = 200) =>
    fetchJSON<Kline[]>(`/v1/market/klines?symbol=${symbol}&limit=${limit}`),
  getSymbols: () => fetchJSON<string[]>('/v1/market/symbols'),
  getAISignals: () => fetchJSON<AISignal[]>('/v1/ai/signals'),
  getAnomalies: () => fetchJSON<AnomalyItem[]>('/v1/ai/anomalies'),
  getRegime: () => fetchJSON<MarketRegimeItem[]>('/v1/ai/regime'),
  getPortfolioSummary: () => fetchJSON<PortfolioSummary>('/v2/portfolio/summary'),
  getPositions: () => fetchJSON<Position[]>('/v2/portfolio/positions'),
};
