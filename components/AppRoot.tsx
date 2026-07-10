'use client';
/* Client SPA shell. Ported from public/js/main.js + core/router.js.
 * Holds the current view + session, mirrors the legacy in-memory navigation
 * (confirm-on-leave-activity, scroll-to-top), and shows the demo-mode banner. */
import { useCallback, useEffect, useState } from 'react';
import { API, type SessionUser } from '@/lib/api';
import { appState } from '@/lib/app-state';
import { AppContext, type ViewName } from '@/components/AppContext';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { LoginView } from '@/components/views/LoginView';
import { HomeView } from '@/components/views/HomeView';
import { PathView } from '@/components/flows/PathView';
import { SettingsView } from '@/components/flows/SettingsView';
import { GameView } from '@/components/game/GameView';
import { ChatView } from '@/components/views/ChatView';
import { StatsView } from '@/components/views/StatsView';
import { DashboardView } from '@/components/views/DashboardView';

export default function AppRoot() {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [view, setView] = useState<ViewName>('home');
  const [tick, setTick] = useState(0);
  const [demo, setDemo] = useState(false);

  const rerender = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    setMounted(true);
    // Hydrate the session singleton from localStorage (same keys as the legacy SPA).
    const token = localStorage.getItem('sl_token');
    if (token) {
      API.token = token;
      try { API.user = JSON.parse(localStorage.getItem('sl_user') || 'null'); } catch { API.user = null; }
      setUser(API.user);
    }
  }, []);

  const nav = useCallback((next: ViewName) => {
    if (appState.game && !appState.game.finished && next !== 'activity' &&
        !window.confirm('Leave the current activity? Your progress will be lost.')) return;
    if (next !== 'activity') appState.game = null;
    setView(next);
    window.scrollTo(0, 0);
  }, []);

  const login = useCallback((token: string, u: SessionUser) => {
    API.setSession(token, u);
    setUser(u);
    setView('home');
  }, []);

  const logout = useCallback(async () => {
    try { await API.post('/api/logout'); } catch { /* ignore */ }
    API.clearSession();
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  // Demo-mode banner: show when the server has no AI provider connected.
  useEffect(() => {
    if (!user) return;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('sl_demo_dismissed') === '1') return;
    let cancelled = false;
    API.get('/api/config').then((cfg: any) => {
      if (!cancelled && cfg && !cfg.aiEnabled) setDemo(true);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [user]);

  if (!mounted) return <main id="app" />;

  if (!user) {
    return (
      <AppContext.Provider value={{ view, nav, rerender, tick, user, login, logout }}>
        <main id="app"><LoginView /></main>
      </AppContext.Provider>
    );
  }

  const views: Record<ViewName, React.ReactNode> = {
    home: <HomeView />,
    path: <PathView />,
    settings: <SettingsView />,
    activity: <GameView />,
    chat: <ChatView />,
    stats: <StatsView />,
    dashboard: <DashboardView />,
  };

  return (
    <AppContext.Provider value={{ view, nav, rerender, tick, user, login, logout }}>
      <Header />
      {demo && (
        <div id="demo-banner" className="demo-banner">
          <span><b>Demo mode</b> — no AI provider is connected, so lessons, charts and suggestions use built-in placeholder content. Set <b>GEMINI_API_KEY</b> or <b>DEEPSEEK_API_KEY</b> in your deployment for real AI lessons.</span>
          <button
            id="demo-banner-x"
            aria-label="Dismiss"
            onClick={() => { try { sessionStorage.setItem('sl_demo_dismissed', '1'); } catch {} setDemo(false); }}
          >×</button>
        </div>
      )}
      <main id="app" key={`${view}-${tick}`}>{views[view]}</main>
      <Footer />
    </AppContext.Provider>
  );
}
