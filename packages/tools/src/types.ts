/**
 * A shadow tool: a named, JSON-schema-described function the orchestrator can expose to
 * any provider. One definition serves both the in-process Claude SDK path and the MCP
 * bridge that agy calls into, so behaviour cannot drift between the two.
 */
export interface ToolContext {
  /** Workspace root. Tools must refuse to escape it. */
  cwd: string;
  /** Called before any side effect. Returning false aborts the tool with an error. */
  approve?: (tool: string, input: unknown) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface ShadowTool<I = any> {
  name: string;
  description: string;
  /** JSON Schema for `input`. Kept plain so it can be handed to any provider verbatim. */
  inputSchema: Record<string, unknown>;
  /** True when the tool can change state — the permission gate only fires for these. */
  mutates: boolean;
  run(input: I, ctx: ToolContext): Promise<string>;
}

export class ToolError extends Error {}
