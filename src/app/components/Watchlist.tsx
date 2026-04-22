import { usePolling } from '../hooks/usePolling';
import { api, MarketOverviewItem } from '../lib/api';

const CRYPTO_NAMES: Record<string, string> = {
  BTCUSDT: 'Bitcoin',
  ETHUSDT: 'Ethereum',
  BNBUSDT: 'Binance Coin',
  SOLUSDT: 'Solana',
  XRPUSDT: 'Ripple',
};

interface WatchlistProps {
  activeSymbol: string;
  onSelect: (symbol: string) => void;
}

export function Watchlist({ activeSymbol, onSelect }: WatchlistProps) {
  const { data: liveData, lastUpdated } = usePolling(() => api.getMarketOverview(), 2000);

  const rows = (liveData ?? []).map((item: MarketOverviewItem) => ({
    sym: item.symbol,
    name: CRYPTO_NAMES[item.symbol] || item.symbol,
    price: item.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    rsi: item.rsi14 != null ? item.rsi14.toFixed(0) : '--',
    up: item.sma7 != null ? item.close > item.sma7 : null,
  }));

  return (
    <div className="flex flex-col h-full bg-[#0b0e17] border border-white/5 rounded-lg overflow-hidden">
      <div className="flex justify-between items-center px-4 py-3 border-b border-white/5 bg-[#080b13] shrink-0">
        <span className="font-bold text-white text-xs tracking-widest uppercase">Watchlist</span>
        {liveData && (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            <span className="text-[9px] text-emerald-400 font-mono">
              {lastUpdated ? lastUpdated.toLocaleTimeString() : 'LIVE'}
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-between px-4 py-2 border-b border-white/5 text-[9px] text-slate-500 uppercase tracking-widest bg-[#0b0e17] shrink-0">
        <span>Symbol</span>
        <div className="flex gap-4">
          <span>Price</span>
          <span>RSI</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs">
            {liveData === null ? 'Loading market data…' : 'No symbols available'}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-white/[0.02]">
            {rows.map((item) => {
              const isActive = item.sym === activeSymbol;
              return (
                <button
                  key={item.sym}
                  onClick={() => onSelect(item.sym)}
                  className={`flex justify-between items-center px-4 py-2.5 transition-colors text-left w-full
                    ${isActive ? 'bg-cyan-500/10 border-l-2 border-cyan-400' : 'hover:bg-white/[0.04] border-l-2 border-transparent'}`}
                >
                  <div className="flex flex-col">
                    <span className={`font-bold text-xs ${isActive ? 'text-cyan-400' : 'text-white'}`}>{item.sym}</span>
                    <span className="text-slate-500 text-[9px] truncate max-w-[80px]">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <span className="text-white font-mono text-xs">{item.price}</span>
                    <span
                      className={`w-[40px] text-right font-mono text-xs ${
                        item.up === true ? 'text-emerald-400' : item.up === false ? 'text-rose-400' : 'text-slate-400'
                      }`}
                    >
                      {item.rsi}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
