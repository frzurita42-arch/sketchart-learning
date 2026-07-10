'use client';
/* A slab of wood with a white paper note pinned on it, carrying an activity's
 * how-to. Ported from renderInstructionPlank() in public/js/views/home.js. */
export function InstructionPlank({ children }: { children: React.ReactNode }) {
  return (
    <div className="instruction-plank">
      <div className="plank-note"><p>{children}</p></div>
    </div>
  );
}
