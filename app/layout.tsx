import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import '@/styles/sketch.css';

export const metadata: Metadata = {
  title: 'SketchLearn — draw your own path',
  description: 'AI-drawn lessons that adapt to every answer you give.',
  // The pencil favicon from the legacy public/index.html.
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='80' font-size='80'%3E%E2%9C%8F%EF%B8%8F%3C/text%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Hand-drawn theme fonts (degrade to system fonts if the CDN is blocked). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Caveat:wght@600;700&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
