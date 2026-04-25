import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { LineChart, Bitcoin, LayoutDashboard, Newspaper, Settings, Search, Bell, Zap, Calculator } from 'lucide-react';
import { useState } from 'react';
import { TradingChart } from './components/TradingChart';
import { MarketOverview } from './components/MarketOverview';
import { NewsPanel } from './components/NewsPanel';
import { OrderBook } from './components/OrderBook';
import { Watchlist } from './components/Watchlist';
import { Screener } from './components/Screener';
import { IntelligencePanel } from './components/IntelligencePanel';
import { Simulator } from './components/Simulator';

const CRYPTO_NAMES: Record<string, string> = {
  BTCUSDT: 'Bitcoin / Tether',
  ETHUSDT: 'Ethereum / Tether',
  BNBUSDT: 'Binance Coin / Tether',
  SOLUSDT: 'Solana / Tether',
  XRPUSDT: 'Ripple / Tether',
};

export default function App() {
  const [activeTab, setActiveTab] = useState('EQUITIES');
  const [cryptoSymbol, setCryptoSymbol] = useState('BTCUSDT');
  const [newsSymbol, setNewsSymbol] = useState('BTCUSDT');

  const navItems = [
    { id: 'OVERVIEW',   icon: <LayoutDashboard size={20} />, label: 'Overview'   },
    { id: 'EQUITIES',   icon: <LineChart size={20} />,       label: 'VN Equities' },
    { id: 'CRYPTO',     icon: <Bitcoin size={20} />,         label: 'Crypto X'   },
    { id: 'NEWS',       icon: <Newspaper size={20} />,       label: 'Intelligence' },
    { id: 'SIMULATOR',  icon: <Calculator size={20} />,      label: 'Simulator'  },
  ];

  return (
    <div className="flex h-screen w-full bg-[#030712] text-slate-300 font-sans overflow-hidden selection:bg-indigo-500/30">
      {/* Slim Left Sidebar */}
      <div className="w-16 bg-[#090b14] border-r border-white/5 flex flex-col items-center py-4 z-50 shadow-[4px_0_24px_rgba(0,0,0,0.5)]">
        <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-cyan-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.4)] mb-8 cursor-pointer relative group">
          <div className="w-3 h-3 bg-white rounded-sm"></div>
          <div className="absolute left-14 bg-white/10 backdrop-blur-md px-2 py-1 rounded text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">XNO Quant Base</div>
        </div>

        <div className="flex flex-col gap-4 w-full">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full h-12 flex items-center justify-center relative group transition-colors
                ${activeTab === item.id ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}
              `}
            >
              {activeTab === item.id && <div className="absolute left-0 w-1 h-8 bg-cyan-500 rounded-r-full shadow-[0_0_10px_rgba(6,182,212,0.8)]"></div>}
              {item.icon}
              <div className="absolute left-14 bg-slate-800 border border-white/10 px-2 py-1 rounded text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl">
                {item.label}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-4 w-full">
          <button className="w-full h-12 flex items-center justify-center text-slate-500 hover:text-white transition-colors relative group">
            <Settings size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Command Bar */}
        <div className="h-12 bg-[#090b14] border-b border-white/5 flex items-center justify-between px-4 z-40 shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-64 group">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
              <input type="text" placeholder="Search symbol or command (Ctrl+K)..." className="w-full bg-[#131825] border border-white/5 rounded-md py-1.5 pl-9 pr-4 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium" />
            </div>

            {/* Live Ticker Tape */}
            <div className="flex-1 overflow-hidden relative hidden md:block">
              <div className="absolute left-0 w-8 h-full bg-gradient-to-r from-[#090b14] to-transparent z-10 pointer-events-none"></div>
              <div className="flex gap-6 animate-[pulse_10s_ease-in-out_infinite] text-[11px] font-mono whitespace-nowrap text-slate-400 uppercase font-medium items-center h-full pt-0.5">
                <span>VNINDEX <span className="text-emerald-400 ml-1">1,250.21 (+1.2%)</span></span>
                <span>VN30 <span className="text-emerald-400 ml-1">1,270.50 (+1.4%)</span></span>
                <span>BTCUSDT <span className="text-emerald-400 ml-1">71,250 (+3.0%)</span></span>
                <span>USDVND <span className="text-rose-400 ml-1">25,450 (-0.1%)</span></span>
                <span>XAUUSD <span className="text-emerald-400 ml-1">2,350 (+0.6%)</span></span>
              </div>
              <div className="absolute right-0 top-0 w-8 h-full bg-gradient-to-l from-[#090b14] to-transparent z-10 pointer-events-none"></div>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <button className="relative text-slate-400 hover:text-white transition-colors">
              <Bell size={16} />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full shadow-[0_0_5px_rgba(244,63,94,0.8)]"></span>
            </button>
            <div className="h-4 w-px bg-white/10"></div>
            <div className="flex items-center gap-2 cursor-pointer group">
              <div className="w-6 h-6 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-[10px] font-bold text-white group-hover:border-cyan-500">KP</div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-white leading-tight">Pro Trader</span>
                <span className="text-[9px] text-cyan-400 leading-tight">Connected <Zap size={8} className="inline ml-0.5" /></span>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic App Workspace */}
        <div className="flex-1 min-h-0 bg-[#000000] p-1.5 relative flex flex-col">

          {activeTab === 'EQUITIES' && (
            <div className="flex flex-col h-full w-full gap-1.5">
              {/* Top Row: Mini Charts */}
              <div className="h-20 shrink-0 grid grid-cols-4 gap-1.5">
                <TradingChart symbol="VNINDEX" price="1,250.21" change="+15.02 (1.2%)" isUp={true} startPrice={1200} minimal={true} />
                <TradingChart symbol="VN30" price="1,270.50" change="+18.10 (1.4%)" isUp={true} startPrice={1260} minimal={true} />
                <TradingChart symbol="HNX" price="235.15" change="-1.20 (-0.5%)" isUp={false} startPrice={240} minimal={true} />
                <TradingChart symbol="UPCOM" price="90.50" change="+0.15 (0.1%)" isUp={true} startPrice={90} minimal={true} />
              </div>

              {/* Resizable Dock */}
              <div className="flex-1 min-h-0 border border-white/[0.03] rounded-lg">
                <PanelGroup direction="horizontal" className="h-full rounded-lg overflow-hidden">
                  <Panel defaultSize={18} minSize={15} maxSize={25} className="bg-[#0b0e17] flex flex-col">
                    <Watchlist type="vn" />
                  </Panel>
                  <PanelResizeHandle className="w-1 bg-[#131825] hover:bg-cyan-500/50 transition-colors flex items-center justify-center group cursor-col-resize">
                    <div className="h-8 w-0.5 bg-white/20 group-hover:bg-cyan-400 rounded-full"></div>
                  </PanelResizeHandle>
                  <Panel defaultSize={60} minSize={40}>
                    <PanelGroup direction="vertical">
                      <Panel defaultSize={65} minSize={30} className="bg-[#0b0e17] relative p-1">
                        <TradingChart symbol="VPB" name="Ngân hàng TMCP VN Thịnh Vượng (HOSE)" price="28.25" change="+0.65 (2.36%)" isUp={true} startPrice={25} />
                      </Panel>
                      <PanelResizeHandle className="h-1 bg-[#131825] hover:bg-cyan-500/50 transition-colors flex items-center justify-center group cursor-row-resize">
                        <div className="w-8 h-0.5 bg-white/20 group-hover:bg-cyan-400 rounded-full"></div>
                      </PanelResizeHandle>
                      <Panel defaultSize={35} minSize={20} className="bg-[#0b0e17] relative">
                        <MarketOverview />
                      </Panel>
                    </PanelGroup>
                  </Panel>
                  <PanelResizeHandle className="w-1 bg-[#131825] hover:bg-cyan-500/50 transition-colors flex items-center justify-center group cursor-col-resize">
                    <div className="h-8 w-0.5 bg-white/20 group-hover:bg-cyan-400 rounded-full"></div>
                  </PanelResizeHandle>
                  <Panel defaultSize={22} minSize={20} maxSize={30} className="bg-[#0b0e17] flex flex-col">
                    <PanelGroup direction="vertical">
                      <Panel defaultSize={55} className="relative">
                        <OrderBook />
                      </Panel>
                      <PanelResizeHandle className="h-1 bg-[#131825] hover:bg-cyan-500/50 transition-colors cursor-row-resize"></PanelResizeHandle>
                      <Panel defaultSize={45} className="relative">
                        <NewsPanel />
                      </Panel>
                    </PanelGroup>
                  </Panel>
                </PanelGroup>
              </div>
            </div>
          )}

          {activeTab === 'CRYPTO' && (
            <PanelGroup direction="horizontal" className="h-full rounded-lg border border-white/[0.03] overflow-hidden">
              <Panel defaultSize={20} minSize={15} maxSize={25} className="bg-[#0b0e17] flex flex-col">
                <Watchlist type="crypto" activeSymbol={cryptoSymbol} onSelect={setCryptoSymbol} />
              </Panel>
              <PanelResizeHandle className="w-1 bg-[#131825] hover:bg-cyan-500/50 transition-colors flex items-center justify-center group cursor-col-resize">
                <div className="h-8 w-0.5 bg-white/20 group-hover:bg-cyan-400 rounded-full"></div>
              </PanelResizeHandle>
              <Panel defaultSize={60} minSize={40} className="bg-[#0b0e17] p-1">
                <TradingChart symbol={cryptoSymbol} name={CRYPTO_NAMES[cryptoSymbol]} />
              </Panel>
              <PanelResizeHandle className="w-1 bg-[#131825] hover:bg-cyan-500/50 transition-colors flex items-center justify-center group cursor-col-resize">
                <div className="h-8 w-0.5 bg-white/20 group-hover:bg-cyan-400 rounded-full"></div>
              </PanelResizeHandle>
              <Panel defaultSize={20} minSize={15} maxSize={30} className="bg-[#0b0e17] flex flex-col relative">
                <OrderBook isCrypto={true} currentPrice={71250} />
              </Panel>
            </PanelGroup>
          )}

          {activeTab === 'OVERVIEW' && (
            <div className="h-full p-2 lg:p-4">
              <Screener />
            </div>
          )}

          {activeTab === 'NEWS' && (
            <div className="flex flex-col h-full gap-2 max-w-[1920px] mx-auto min-h-0">
              <div className="h-56 shrink-0 px-2">
                <div className="w-full h-full bg-[#0b0e17] rounded-lg border border-white/5 overflow-hidden shadow-xl p-1 relative">
                  <TradingChart symbol={newsSymbol} name={CRYPTO_NAMES[newsSymbol]} />
                </div>
              </div>
              <div className="flex-1 min-h-0 px-2">
                <IntelligencePanel onSymbolSelect={setNewsSymbol} />
              </div>
            </div>
          )}

          {activeTab === 'SIMULATOR' && (
            <div className="h-full overflow-hidden">
              <Simulator />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
