interface OrderBookProps {
  isCrypto?: boolean;
  currentPrice?: number;
}

export function OrderBook({ isCrypto: _isCrypto, currentPrice: _currentPrice }: OrderBookProps) {
  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex items-center px-4 py-2.5 border-b border-white/5 bg-[#080b13] shrink-0">
        <span className="font-bold text-white text-xs tracking-widest uppercase">Order Book</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-slate-600 text-xs">
        Coming soon
      </div>
    </div>
  );
}
