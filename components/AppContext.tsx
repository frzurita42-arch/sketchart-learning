'use client';
import { createContext, useContext } from 'react';
import type { SessionUser } from '@/lib/api';

export type ViewName = 'home' | 'path' | 'settings' | 'activity' | 'chat' | 'stats' | 'dashboard';

export interface AppContextValue {
  view: ViewName;
  nav: (view: ViewName) => void;
  // Re-render the tree after mutating the shared appState singleton in place.
  rerender: () => void;
  tick: number;
  user: SessionUser | null;
  login: (token: string, user: SessionUser) => void;
  logout: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <AppRoot>');
  return ctx;
}
