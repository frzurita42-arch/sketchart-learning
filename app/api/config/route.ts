import '@/lib/legacy-env';
import { NextResponse } from 'next/server';
import { geminiEnabled, deepseekEnabled, imageEnabled } from '@/src/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Public runtime config so the client can show a "demo mode" banner when no AI is set.
export async function GET() {
  return NextResponse.json(
    {
      aiEnabled: !!(geminiEnabled || deepseekEnabled),
      provider: geminiEnabled ? 'gemini' : (deepseekEnabled ? 'deepseek' : null),
      imagesEnabled: !!imageEnabled,
    },
    { headers: { 'Cache-Control': 'no-cache' } }
  );
}
