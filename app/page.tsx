import AppRoot from '@/components/AppRoot';

// The whole SketchLearn SPA lives in this one client-managed shell, mirroring
// the legacy in-memory view switching (public/js/main.js + core/router.js).
export default function Page() {
  return <AppRoot />;
}
