/**
 * marked-terminal ships no type declarations. Only the surface flick uses is declared;
 * the options object is intentionally loose because the library accepts many renderer
 * overrides we do not exercise.
 */
declare module 'marked-terminal' {
  export function markedTerminal(options?: Record<string, unknown>): unknown;
  const _default: typeof markedTerminal;
  export default _default;
}
