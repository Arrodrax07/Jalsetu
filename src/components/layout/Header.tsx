import React, { useState, useEffect } from 'react';
import {
  Droplets,
  Search,
  Bell,
  Sparkles,
  Shield,
  UserCheck,
  LogOut,
  ChevronDown,
  Clock,
  Radio,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { useWaterData } from '../../context/WaterDataContext';
import { UserRole } from '../../types';

export const Header: React.FC = () => {
  const {
    currentUser,
    login,
    logout,
    startPitchMode,
    isPitchModeActive,
    requests,
    complaints,
    setActiveTab,
    setSelectedCommunity,
    communities
  } = useWaterData();

  const [currentTime, setCurrentTime] = useState<string>('');
  const [showRoleDropdown, setShowRoleDropdown] = useState<boolean>(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<{ type: string; title: string; subtitle: string; action: () => void }[]>([]);
  const [showSearchResults, setShowSearchResults] = useState<boolean>(false);

  // Live IST Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Live Search logic
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const q = searchQuery.toLowerCase();
    const results: { type: string; title: string; subtitle: string; action: () => void }[] = [];

    // Search communities
    communities.forEach(c => {
      if (c.name.toLowerCase().includes(q) || c.ward.toLowerCase().includes(q)) {
        results.push({
          type: 'Community',
          title: c.name,
          subtitle: `${c.ward} • Pop: ${c.population.toLocaleString()} • Status: ${c.status}`,
          action: () => {
            setSelectedCommunity(c);
            setActiveTab('communities');
            setShowSearchResults(false);
            setSearchQuery('');
          }
        });
      }
    });

    // Search requests
    requests.forEach(r => {
      if (r.id.toLowerCase().includes(q) || r.communityName.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q)) {
        results.push({
          type: 'Request',
          title: `${r.id} (${r.communityName})`,
          subtitle: `${r.requestedAmount.toLocaleString()} L • Urgency: ${r.urgency} • Status: ${r.status}`,
          action: () => {
            setActiveTab('requests');
            setShowSearchResults(false);
            setSearchQuery('');
          }
        });
      }
    });

    setSearchResults(results.slice(0, 6));
    setShowSearchResults(true);
  }, [searchQuery, communities, requests, setActiveTab, setSelectedCommunity]);

  const criticalCount = requests.filter(r => r.urgency === 'Critical' && r.status === 'Pending').length;
  const criticalComplaints = complaints.filter(c => c.severity === 'Critical' && c.status !== 'Resolved').length;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-subtle">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-card">
            <Droplets className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-1.5">
                JalSetu <span className="text-sky-600 font-extrabold text-sm px-1.5 py-0.5 rounded bg-sky-100/80 border border-sky-200">AI</span>
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Radio className="w-3 h-3 text-emerald-500 animate-pulse" /> Live Telemetry
              </span>
            </div>
            <p className="text-[11px] font-medium text-slate-500 hidden sm:block">
              Fair Water. Stronger Communities.
            </p>
          </div>
        </div>

        {/* Center: Search with instant dropdown */}
        <div className="relative flex-1 max-w-md hidden md:block">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search communities, request IDs, ward officers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery && setShowSearchResults(true)}
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all"
            />
          </div>

          {showSearchResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl shadow-elevated border border-slate-200 py-2 z-50 animate-scale-in">
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Quick Results</p>
              {searchResults.map((res, i) => (
                <button
                  key={i}
                  onClick={res.action}
                  className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between group transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 group-hover:text-sky-600">{res.title}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-500">{res.type}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate max-w-xs">{res.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Pitch Button, Clock, Role Selector & Notifications */}
        <div className="flex items-center gap-3">
          {/* Pitch Demo Trigger Button */}
          <button
            onClick={startPitchMode}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs shadow-sm transition-all ${
              isPitchModeActive
                ? 'bg-amber-500 text-white hover:bg-amber-600 ring-2 ring-amber-300 animate-pulse'
                : 'bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 text-white shadow-glow'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isPitchModeActive ? 'Pitching Mode Active' : 'Pitch Demo'}</span>
          </button>

          {/* Live Clock */}
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>{currentTime || '07:30 PM'} IST</span>
          </div>

          {/* Notifications Trigger */}
          <div className="relative">
            <button
              onClick={() => setShowNotifDropdown(!showNotifDropdown)}
              className="relative p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {(criticalCount > 0 || criticalComplaints > 0) && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white animate-ping" />
              )}
            </button>

            {showNotifDropdown && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-elevated border border-slate-200 py-3 z-50 animate-scale-in">
                <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">Civic Alerts</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-semibold">
                    {criticalCount + criticalComplaints} Critical
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-50">
                  <div className="p-3 hover:bg-slate-50 cursor-pointer" onClick={() => { setActiveTab('requests'); setShowNotifDropdown(false); }}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-rose-600">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Critical Shortfall: Shivaji Nagar
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      WR-1024 pending 15,000 L allocation. 3rd day dry pipeline.
                    </p>
                    <span className="text-[10px] text-slate-400 mt-1 block">12 min ago</span>
                  </div>

                  <div className="p-3 hover:bg-slate-50 cursor-pointer" onClick={() => { setActiveTab('deliveryVerification'); setShowNotifDropdown(false); }}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-600">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Delivery Variance Detected
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Delivery #DV-4022 has a 5,000 L shortfall between meter and receipt.
                    </p>
                    <span className="text-[10px] text-slate-400 mt-1 block">45 min ago</span>
                  </div>

                  <div className="p-3 hover:bg-slate-50 cursor-pointer" onClick={() => { setActiveTab('allocation'); setShowNotifDropdown(false); }}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      AI Allocation Balanced
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Fairness Index reached 84% across all 10 monitored wards.
                    </p>
                    <span className="text-[10px] text-slate-400 mt-1 block">1 hr ago</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* User Profile & Role Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowRoleDropdown(!showRoleDropdown)}
              className="flex items-center gap-2 p-1.5 pl-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-800 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs">
                {currentUser?.role === 'admin' ? <Shield className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-bold leading-tight text-slate-900">{currentUser?.name.split(' ')[0]}</p>
                <p className="text-[10px] text-slate-500 capitalize">{currentUser?.role}</p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {showRoleDropdown && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-elevated border border-slate-200 py-2 z-50 animate-scale-in">
                <div className="px-4 py-2.5 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900">{currentUser?.name}</p>
                  <p className="text-[11px] text-slate-500">{currentUser?.designation}</p>
                </div>

                <div className="p-1">
                  <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Switch Role</p>
                  <button
                    onClick={() => { login('admin'); setShowRoleDropdown(false); }}
                    className={`w-full px-3 py-2 rounded-lg text-left text-xs font-medium flex items-center justify-between ${
                      currentUser?.role === 'admin' ? 'bg-sky-50 text-sky-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>Administrator (Commissioner)</span>
                    {currentUser?.role === 'admin' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />}
                  </button>

                  <button
                    onClick={() => { login('officer'); setShowRoleDropdown(false); }}
                    className={`w-full px-3 py-2 rounded-lg text-left text-xs font-medium flex items-center justify-between ${
                      currentUser?.role === 'officer' ? 'bg-sky-50 text-sky-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>Field Officer (Ward M/East)</span>
                    {currentUser?.role === 'officer' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />}
                  </button>

                  <button
                    onClick={() => { login('demo'); setShowRoleDropdown(false); }}
                    className={`w-full px-3 py-2 rounded-lg text-left text-xs font-medium flex items-center justify-between ${
                      currentUser?.role === 'demo' ? 'bg-sky-50 text-sky-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>Hackathon Pitch Evaluator</span>
                    {currentUser?.role === 'demo' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" />}
                  </button>
                </div>

                <div className="border-t border-slate-100 mt-1 pt-1 p-1">
                  <button
                    onClick={() => { logout(); setShowRoleDropdown(false); }}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Log Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
