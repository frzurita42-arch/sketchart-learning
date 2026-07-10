/* The legacy backend under `src/` is framework-agnostic CommonJS that we reuse
 * verbatim (db, auth, AI providers, prompts, slide policy). We deliberately do
 * NOT type-check or fully TS-type it — TypeScript's structural inference from
 * the plain JS is too narrow (e.g. a `= null` default param infers the param
 * type as `null`), which would fight the verbatim port.
 *
 * These ambient declarations make every `@/src/...` import resolve as `any` for
 * type-checking purposes. The Next.js bundler still resolves and bundles the
 * real JS files at build time — this only affects types. */

declare module '@/src/config';
declare module '@/src/auth';
declare module '@/src/db/pool';
declare module '@/src/db/persistence';
declare module '@/src/db/users';
declare module '@/src/db/games';
declare module '@/src/db/caches';
declare module '@/src/ai/providers';
declare module '@/src/ai/prompts/coach';
declare module '@/src/ai/prompts/learning-path';
declare module '@/src/ai/prompts/home-topics';
declare module '@/src/ai/prompts/suggested-topic';
declare module '@/src/ai/prompts/time-travel-headline';
declare module '@/src/ai/prompts/structured-suggest';
declare module '@/src/ai/prompts/level-refresh';
declare module '@/src/ai/prompts/slide';
declare module '@/src/slides/sanitize';
declare module '@/src/slides/fallback';
declare module '@/src/slides/visual-policy';
