/**
 * Exposes `Orchestrator.delegate` to a Claude lead agent as an in-process MCP tool.
 *
 * The SDK runs this server inside the same Node process, so a delegation is a direct
 * function call — no extra spawn, no serialization beyond the tool arguments.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ProviderId } from '@shadow/providers';
import type { Orchestrator } from './orchestrator.js';

/** MCP tool name as the model sees it, once the SDK applies its naming convention. */
export const DELEGATE_TOOL_NAME = 'mcp__shadow__delegate';

export function buildDelegateServer(orchestrator: Orchestrator) {
  const agents = orchestrator.listAgents();
  const roster =
    agents.length > 0
      ? agents
          .map((a) => `- ${a.name} (${a.provider}${a.model ? `/${a.model}` : ''}): ${a.description}`)
          .join('\n')
      : '(no agents defined yet — create .shadow/agents/*.md)';

  return createSdkMcpServer({
    name: 'shadow',
    version: '0.1.0',
    instructions:
      'shadow lets you delegate a self-contained task to a subagent, possibly running ' +
      'on a different model provider than you. The subagent starts with a blank ' +
      'context and returns only its final answer, so give it everything it needs and ' +
      'ask for exactly the output you want back.',
    tools: [
      tool(
        'delegate',
        `Run a task on a subagent and get back its final answer.\n\n` +
          `Available agents:\n${roster}\n\n` +
          `Delegate when a task is self-contained and would otherwise flood your own ` +
          `context — broad codebase searches, reading many files, independent reviews. ` +
          `Several delegate calls in one turn run in parallel.\n\n` +
          `You are not limited to the roster. Pass \`model\` (and \`provider\` when the ` +
          `model name is ambiguous) to spin up an agent on the spot: if the user asks ` +
          `for "two gemini-3.6-flash-medium agents", make two calls with that model and ` +
          `any short label for each. Known models — agy: gemini-3.6-flash-{low,medium,` +
          `high}, gemini-3.1-pro-{low,high}; claude: opus, sonnet, haiku.`,
        {
          agent: z
            .string()
            .describe('Agent name from the roster, or any short label for an ad-hoc agent'),
          prompt: z
            .string()
            .describe(
              'The full task. The subagent shares your working directory but sees none ' +
                'of your conversation, so restate any context it needs.',
            ),
          provider: z
            .enum(['claude', 'agy'])
            .optional()
            .describe("Override the agent's provider"),
          model: z.string().optional().describe("Override the agent's model"),
        },
        async (args) => {
          const result = await orchestrator.delegate({
            agent: args.agent,
            prompt: args.prompt,
            provider: args.provider as ProviderId | undefined,
            model: args.model,
          });
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
    ],
  });
}
