'use client';
/* Browser memory: cache prefetched branch slides in sessionStorage.
 * Ported from public/js/game/memory.js. Every option's next slide is generated
 * in the background; the branches the learner does not pick are dumped. */
import { hashText } from '@/lib/util';

const SLIDE_MEM_PREFIX = 'sketch:slide:';

function slideMemKey(gameId: string, slideNumber: number, branchText: string) {
  return `${SLIDE_MEM_PREFIX}${gameId}:${slideNumber}:${hashText(branchText || 'root')}`;
}

function pruneSlideMem() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SLIDE_MEM_PREFIX)) keys.push(k);
    }
    keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => sessionStorage.removeItem(k));
  } catch { /* sessionStorage unavailable */ }
}

export function memGetSlide(gameId: string, slideNumber: number, branchText: string): any {
  try {
    const v = sessionStorage.getItem(slideMemKey(gameId, slideNumber, branchText));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

export function memPutSlide(gameId: string, slideNumber: number, branchText: string, slide: any) {
  if (!slide) return;
  const write = () => sessionStorage.setItem(slideMemKey(gameId, slideNumber, branchText), JSON.stringify(slide));
  try { write(); }
  catch { pruneSlideMem(); try { write(); } catch { /* over quota, skip cache */ } }
}

export function clearSlideMem(gameId?: string) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && (!gameId || k.startsWith(`${SLIDE_MEM_PREFIX}${gameId}:`))) keys.push(k);
    }
    keys.forEach(k => sessionStorage.removeItem(k));
  } catch { /* sessionStorage unavailable */ }
}
