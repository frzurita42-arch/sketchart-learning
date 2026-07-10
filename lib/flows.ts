'use client';
/* Learning-path flow controller. Ported from loadPath() in
 * public/js/flows/path.js. Drives the shared appState + navigates to the path
 * view, showing loading/error states the PathView renders. */
import { API } from '@/lib/api';
import { appState } from '@/lib/app-state';
import { withTimeout } from '@/lib/util';
import type { ViewName } from '@/components/AppContext';

export interface FlowApp {
  nav: (view: ViewName) => void;
  rerender: () => void;
}

export async function loadPath(app: FlowApp, topic: string, guidance?: string, levels?: string[], opts: any = {}) {
  appState.topic = topic;
  appState.path = null;
  appState.pathError = null;
  appState.pathLoading = opts.fromHistory
    ? 'Re-recommending concepts based on your play history…'
    : `Asking the AI to sketch a learning path for “${topic}”…`;
  appState.pathRequest = { topic, guidance, levels, opts };
  app.nav('path');
  app.rerender();
  try {
    const path = await withTimeout(API.post('/api/ai/path', {
      topic, guidance, levels,
      fromHistory: !!opts.fromHistory,
      freshSeed: opts.fresh ? Math.random().toString(36).slice(2, 8) : undefined,
    }), 30000, 'Path generation timed out. Please try again.');
    if (!path) return;
    appState.path = path;
    appState.pathLoading = null;
    app.rerender();
  } catch (e: any) {
    appState.pathLoading = null;
    appState.pathError = e.message;
    app.rerender();
  }
}
