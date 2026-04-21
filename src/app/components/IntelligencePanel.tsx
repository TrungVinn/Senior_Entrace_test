import { AlertTriangle, TrendingUp, Zap, ArrowDownRight, Tag, Layers } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api, AISignal, AnomalyItem, MarketRegimeItem } from '../lib/api';

export function IntelligencePanel() {
  const { data: signals } = usePolling(() => api.getAISignals(), 15000);
  const { data: anomalies } = usePolling(() => api.getAnomalies(), 15000);
  const { data: regimes } = usePolling(() => api.getRegime(), 30000);

  return (
    <div className="flex flex-col h-full gap-3 min-h-0 text-slate-300">
      {/* Market Regime — one row per symbol */}
      <div className="flex flex-col bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden shrink-0">
        <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center gap-2">
          <Layers size={14} className="text-indigo-400" />
          <span className="text-white font-bold tracking-widest text-xs uppercase">Market Regime</span>
        </div>
        <div className="p-3 grid grid-cols-2 gap-2">
          {regimes && regimes.length > 0 ? (
            regimes.map((r: MarketRegimeItem) => (
              <div key={r.symbol} className="flex items-center justify-between px-2 py-1.5 rounded bg-white/[0.02]">
                <span className="font-bold text-xs text-white">{r.symbol}</span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-widest ${
                    r.regime === 'high'
                      ? 'bg-rose-500/20 text-rose-400'
                      : r.regime === 'medium'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}
                >
                  {r.regime}
                </span>
              </div>
            ))
          ) : (
            <div className="col-span-2 text-center text-slate-500 text-xs py-2">
              {regimes === null ? 'Loading…' : 'No regime data'}
            </div>
          )}
        </div>
      </div>

      {/* AI Signal Scoring */}
      <div className="flex-1 flex flex-col bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden min-h-0">
        <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Tag size={14} className="text-cyan-400" />
            <span className="text-white font-bold tracking-widest text-xs uppercase">AI Signal Scoring</span>
          </div>
          {signals && signals.length > 0 && (
            <span className="text-[9px] text-emerald-400 font-mono animate-pulse">LIVE</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto hide-scrollbar p-3 flex flex-col gap-2">
          {signals && signals.length > 0 ? (
            signals.map((sig: AISignal, i: number) => {
              const isBuy = sig.signal === 'BUY';
              const isSell = sig.signal === 'SELL';
              return (
                <div
                  key={i}
                  className="flex justify-between items-center p-3 border border-white/5 rounded-lg bg-white/[0.02]"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center border ${
                        isBuy
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : isSell
                          ? 'bg-rose-500/10 border-rose-500/30'
                          : 'bg-slate-500/10 border-slate-500/30'
                      }`}
                    >
                      {isBuy ? (
                        <TrendingUp size={16} className="text-emerald-400" />
                      ) : isSell ? (
                        <ArrowDownRight size={16} className="text-rose-400" />
                      ) : (
                        <AlertTriangle size={16} className="text-slate-400" />
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-bold text-white text-xs">
                        {sig.symbol}
                        <span
                          className={`ml-2 text-[9px] font-mono px-1.5 py-0.5 rounded ${
                            isBuy
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : isSell
                              ? 'bg-rose-500/20 text-rose-400'
                              : 'bg-slate-500/20 text-slate-400'
                          }`}
                        >
                          {sig.signal}
                        </span>
                      </span>
                      <span className="text-[10px] text-slate-500">
                        RSI {sig.rsiComponent.toFixed(2)} · SMA {sig.smaComponent.toFixed(2)} · Vol{' '}
                        {sig.volumeComponent.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`font-mono font-bold text-base leading-none ${
                      isBuy ? 'text-emerald-400' : isSell ? 'text-rose-400' : 'text-slate-400'
                    }`}
                  >
                    {sig.score.toFixed(2)}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              {signals === null ? 'Loading AI signals…' : 'No signals — start the AI runner'}
            </div>
          )}
        </div>
      </div>

      {/* Anomaly Detection */}
      <div className="flex-[0.8] flex flex-col bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden min-h-0">
        <div className="px-4 py-2.5 border-b border-white/5 bg-[#080b13] flex items-center gap-2 shrink-0">
          <Zap size={14} className="text-indigo-400" />
          <span className="text-white font-bold tracking-widest text-xs uppercase">Anomalies</span>
        </div>
        <div className="flex-1 overflow-y-auto hide-scrollbar p-3 flex flex-col gap-2">
          {anomalies && anomalies.length > 0 ? (
            anomalies.map((a: AnomalyItem, i: number) => (
              <div
                key={i}
                className="flex flex-col p-3 border-l-2 border-indigo-500 bg-white/[0.01] rounded-r"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-indigo-400 text-xs tracking-widest uppercase">
                    {a.type} · {a.symbol}
                  </span>
                  <span
                    className={`text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded ${
                      a.severity === 'high'
                        ? 'bg-rose-500/20 text-rose-400'
                        : a.severity === 'medium'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-slate-500/20 text-slate-400'
                    }`}
                  >
                    {a.severity}
                  </span>
                </div>
                <span className="text-xs text-slate-300 leading-relaxed">{a.description}</span>
              </div>
            ))
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              {anomalies === null ? 'Loading…' : 'No anomalies — market stable'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
