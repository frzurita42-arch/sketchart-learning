'use client';
/* Background cache warmers fired after home-page interactions.
 * Ported from triggerHomePreloads() in public/js/views/home.js. */
import { API } from '@/lib/api';
import { appState } from '@/lib/app-state';

export function triggerHomePreloads(triggerTopic = '') {
  API.post('/api/ai/topics/preload', {
    triggerTopic,
    avoid: [appState.topic, ...(appState.homeTopics || [])].filter(Boolean),
  }).catch(() => {});

  API.post('/api/ai/suggested-topic/preload', {
    triggerTopic,
    avoidTopics: [appState.topic, ...(appState.homeTopics || []), appState.homeSuggestion?.topic].filter(Boolean),
  }).catch(() => {});
}
