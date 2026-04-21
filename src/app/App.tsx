import { useState } from 'react';
import { Activity } from 'lucide-react';
import { TradingChart } from './components/TradingChart';
import { Watchlist } from './components/Watchlist';
import { IntelligencePanel } from './components/IntelligencePanel';
import { MetricCards } from './components/MetricCards';

export default function App() {
  const [activeSymbol, setActiveSymbol] = useState<string>('BTCUSDT');

  return (
    <div className="flex flex-col h-screen w-full bg-[#030712] text-slate-300 font-sans overflow-hidden selection:bg-indigo-500/30">
      {/* Header */}
      <header className="h-12 bg-[#090b14] border-b border-white/5 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-cyan-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.4)]">
            <Activity size={16} className="text-white" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-white font-bold text-sm">XNO Quant</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">
              Crypto Market Intelligence
            </span>
          </div>
        </div>
      </header>

      {/* Body: 3-column layout */}
      <div className="flex-1 min-h-0 grid grid-cols-[240px_1fr_340px] gap-3 p-3">
        {/* Left: Watchlist (data list/table) */}
        <div className="min-h-0">
          <Watchlist activeSymbol={activeSymbol} onSelect={setActiveSymbol} />
        </div>

        {/* Center: Metric cards + TradingChart */}
        <div className="flex flex-col gap-3 min-h-0">
          <MetricCards symbol={activeSymbol} />
          <div className="flex-1 min-h-0">
            <TradingChart symbol={activeSymbol} />
          </div>
        </div>

        {/* Right: Intelligence panel (AI signals, anomalies, regime) */}
        <div className="min-h-0">
          <IntelligencePanel />
        </div>
      </div>
    </div>
  );
}
