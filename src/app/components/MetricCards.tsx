import { usePolling } from '../hooks/usePolling';
import { api, AISignal, MarketOverviewItem, Kline } from '../lib/api';
import { TrendingUp, TrendingDown, Activity, Target } from 'lucide-react';

interface Props {
  symbol: string;
}

export function MetricCards({ symbol }: Props) {
  const { data: overview } = usePolling(() => api.getMarketOverview(), 2000);
  const { data: signals } = usePolling(() => api.getAISignals(), 10000);
  const { data: klines } = usePolling(() => api.getKlines(symbol, 60), 3000, [symbol]);

  const row = overview?.find((r: MarketOverviewItem) => r.symbol === symbol);
  const signal = signals?.find((s: AISignal) => s.symbol === symbol);

  const change = (() => {
    if (!klines || klines.length < 2) return null;
    const sorted = [...klines].sort(
      (a: Kline, b: Kline) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const first = sorted[0].close;
    const last = sorted[sorted.length - 1].close;
    return ((last - first) / first) * 100;
  })();

  const price = row?.close;
  const rsi = row?.rsi14 ?? null;

  const changeUp = change != null && change >= 0;
  const signalColor =
    signal?.signal === 'BUY'
      ? 'text-emerald-400'
      : signal?.signal === 'SELL'
      ? 'text-rose-400'
      : 'text-slate-400';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 w-full">
      <Card
        label="Price"
        icon={<Target size={14} className="text-indigo-400" />}
        value={price != null ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        sub={`${symbol}`}
      />
      <Card
        label="Change (1h)"
        icon={changeUp ? <TrendingUp size={14} className="text-emerald-400" /> : <TrendingDown size={14} className="text-rose-400" />}
        value={change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
        sub={klines ? `${klines.length} klines` : 'loading'}
        tone={changeUp ? 'up' : change != null ? 'down' : undefined}
      />
      <Card
        label="RSI (14)"
        icon={<Activity size={14} className="text-cyan-400" />}
        value={rsi != null ? rsi.toFixed(1) : '—'}
        sub={
          rsi == null
            ? 'loading'
            : rsi >= 70
            ? 'overbought'
            : rsi <= 30
            ? 'oversold'
            : 'neutral'
        }
        tone={rsi != null && rsi >= 70 ? 'down' : rsi != null && rsi <= 30 ? 'up' : undefined}
      />
      <Card
        label="AI Signal"
        icon={<Target size={14} className={signalColor} />}
        value={signal?.signal ?? '—'}
        sub={signal ? `score ${signal.score.toFixed(2)}` : 'no signal'}
        tone={signal?.signal === 'BUY' ? 'up' : signal?.signal === 'SELL' ? 'down' : undefined}
      />
    </div>
  );
}

function Card({
  label,
  icon,
  value,
  sub,
  tone,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  sub: string;
  tone?: 'up' | 'down';
}) {
  const valueColor = tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-rose-400' : 'text-white';
  return (
    <div className="bg-[#0b0e17] border border-white/5 rounded-lg p-4 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
        {icon}
        {label}
      </div>
      <div className={`font-mono font-bold text-2xl leading-none ${valueColor}`}>{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-widest">{sub}</div>
    </div>
  );
}
