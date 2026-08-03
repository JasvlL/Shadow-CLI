import { editTool, globTool, readTool, writeTool } from './fs.js';
import { bashTool, grepTool } from './shell.js';
import type { FlickTool } from './types.js';

export * from './types.js';
export { resolveInside, readTool, writeTool, editTool, globTool } from './fs.js';
export { bashTool, grepTool, findDestructivePattern, DESTRUCTIVE_PATTERNS } from './shell.js';

/** Every built-in tool, in the order they should be presented to a model. */
export const builtinTools: FlickTool[] = [
  readTool,
  globTool,
  grepTool,
  editTool,
  writeTool,
  bashTool,
];

export const readOnlyTools: FlickTool[] = builtinTools.filter((t) => !t.mutates);

export function toolByName(name: string): FlickTool | undefined {
  return builtinTools.find((t) => t.name === name);
}
