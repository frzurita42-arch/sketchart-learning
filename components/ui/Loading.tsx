// The pencil loading indicator. Mirrors loadingHTML() from public/js/ui/shared.js.
export function Loading({ text }: { text?: string }) {
  return (
    <div className="loading">
      <span className="pencil">✏️</span>
      <p>{text || 'Sketching your slide…'}</p>
    </div>
  );
}
