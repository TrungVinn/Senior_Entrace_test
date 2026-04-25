import { usePolling } from '../hooks/usePolling';
import { api, MarketOverviewItem } from '../lib/api';

const CRYPTO_NAMES: Record<string, string> = {
  BTCUSDT: 'Bitcoin',
  ETHUSDT: 'Ethereum',
  BNBUSDT: 'Binance Coin',
  SOLUSDT: 'Solana',
  XRPUSDT: 'Ripple',
};

const VN_STOCKS = [
  { sym: 'VPB', name: 'Ngân hàng VN Thịnh Vượng', p: '28.25', c: '+2.36%', up: true },
  { sym: 'FPT', name: 'Tập đoàn FPT', p: '76.00', c: '+2.56%', up: true },
  { sym: 'HPG', name: 'Tập đoàn Hòa Phát', p: '28.00', c: '+0.18%', up: true },
  { sym: 'NVL', name: 'Tập đoàn Novaland', p: '17.05', c: '0.00%', up: null },
  { sym: 'VHM', name: 'Vinhomes', p: '135.70', c: '-5.17%', up: false },
  { sym: 'VCB', name: 'Vietcombank', p: '59.50', c: '+0.17%', up: true },
  { sym: 'MWG', name: 'Thế Giới Di Động', p: '56.90', c: '+6.89%', up: true },
  { sym: 'SSI', name: 'Chứng khoán SSI', p: '36.65', c: '+0.41%', up: true },
  { sym: 'DIG', name: 'DIC Corp', p: '3.51', c: '-0.85%', up: false },
  { sym: 'GAS', name: 'PV GAS', p: '80.10', c: '+2.17%', up: true },
  { sym: 'MBB', name: 'Ngân hàng MB', p: '26.45', c: '+0.57%', up: true },
];

interface WatchlistProps {
  type?: 'vn' | 'crypto';
  activeSymbol?: string;
  onSelect?: (symbol: string) => void;
}

export function Watchlist({ type = 'crypto', activeSymbol, onSelect }: WatchlistProps) {
  const { data: liveData, lastUpdated } = usePolling(
    () => (type === 'crypto' ? api.getMarketOverview() : Promise.resolve(null)),
    2000
  );

  if (type === 'vn') {
    return (
      <div className="flex flex-col h-full bg-transparent overflow-hidden">
        <div className="flex justify-between items-center px-4 py-3 border-b border-white/5 bg-[#080b13] shrink-0">
          <span className="font-bold text-white text-xs tracking-widest uppercase">Watchlist</span>
          <button className="text-cyan-400 hover:text-cyan-300 text-xs font-semibold">+</button>
        </div>
        <div className="flex justify-between px-4 py-2 border-b border-white/5 text-[9px] text-slate-500 uppercase tracking-widest bg-[#0b0e17] shrink-0">
          <span>Symbol</span>
          <div className="flex gap-4">
            <span>Price</span>
            <span>24h%</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto hide-scrollbar">
          <div className="flex flex-col divide-y divide-white/[0.02]">
            {VN_STOCKS.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center px-4 py-2.5 hover:bg-white/[0.04] transition-colors cursor-pointer group">
                <div className="flex flex-col">
                  <span className="text-white font-bold text-xs group-hover:text-cyan-400 transition-colors">{item.sym}</span>
                  <span className="text-slate-500 text-[9px] truncate max-w-[80px]">{item.name}</span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <span className="text-white font-mono text-xs">{item.p}</span>
                  <span className={`w-[50px] text-right font-mono text-xs
                    ${item.up === true ? 'text-emerald-400' : item.up === false ? 'text-rose-400' : 'text-slate-400'}
                  `}>{item.c}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Crypto live watchlist
  const rows = (liveData ?? []).map((item: MarketOverviewItem) => ({
    sym: item.symbol,
    name: CRYPTO_NAMES[item.symbol] || item.symbol,
    price: item.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    rsi: item.rsi14 != null ? item.rsi14.toFixed(0) : '--',
    up: item.sma7 != null ? item.close > item.sma7 : null,
  }));

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden">
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
                  onClick={() => onSelect?.(item.sym)}
                  className={`flex justify-between items-center px-4 py-2.5 transition-colors text-left w-full
                    ${isActive ? 'bg-cyan-500/10 border-l-2 border-cyan-500' : 'hover:bg-white/[0.04] border-l-2 border-transparent'}`}
                >
                  <div className="flex flex-col">
                    <span className={`font-bold text-xs ${isActive ? 'text-cyan-400' : 'text-white'}`}>{item.sym}</span>
                    <span className="text-slate-500 text-[9px] truncate max-w-[80px]">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <span className="text-white font-mono text-xs">{item.price}</span>
                    <span className={`w-[40px] text-right font-mono text-xs ${
                      item.up === true ? 'text-emerald-400' : item.up === false ? 'text-rose-400' : 'text-slate-400'
                    }`}>
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
