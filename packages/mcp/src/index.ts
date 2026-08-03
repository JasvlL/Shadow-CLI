/**
 * The reverse bridge.
 *
 * Claude reaches subagents through an in-process tool. agy cannot — it runs in its own
 * process. But agy speaks MCP, so exposing shadow's delegation over a stdio MCP server
 * lets a Gemini lead call into a Claude subagent. That is what makes delegation
 * bidirectional instead of one-way.
 *
 * Registered in agy's MCP config as: `shadow mcp`
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Orchestrator } from '@shadow/core';
import type { ProviderId } from '@shadow/providers';

export interface BridgeOptions {
  cwd: string;
}

export async function startMcpBridge(opts: BridgeOptions): Promise<void> {
  const orchestrator = new Orchestrator({ cwd: opts.cwd });
  await orchestrator.init();

  const agents = orchestrator.listAgents();
  const roster =
    agents.length > 0
      ? agents
          .map((a) => `- ${a.name} (${a.provider}${a.model ? `/${a.model}` : ''}): ${a.description}`)
          .join('\n')
      : '(no agents defined — create .shadow/agents/*.md)';

  const server = new McpServer({ name: 'shadow', version: '0.1.0' });

  server.registerTool(
    'delegate',
    {
      title: 'Delegate to a shadow subagent',
      description:
        `Run a task on a shadow subagent and get back its final answer. The subagent ` +
        `may run on a different model provider than you.\n\nAvailable agents:\n${roster}\n\n` +
        `The subagent starts with an empty context, so restate anything it needs.\n\n` +
        `You are not limited to the roster: pass \`model\` (and \`provider\` when the ` +
        `model name is ambiguous) to create an agent on the spot, and call this tool ` +
        `several times to run them in parallel.`,
      inputSchema: {
        agent: z
          .string()
          .describe('Agent name from the roster, or any short label for an ad-hoc agent'),
        prompt: z.string().describe('The full self-contained task'),
        provider: z.enum(['claude', 'agy']).optional().describe("Override the agent's provider"),
        model: z.string().optional().describe("Override the agent's model"),
      },
    },
    async ({ agent, prompt, provider, model }) => {
      const result = await orchestrator.delegate({
        agent,
        prompt,
        provider: provider as ProviderId | undefined,
        model,
      });
      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.registerTool(
    'list_agents',
    {
      title: 'List shadow subagents',
      description: 'Return the agents available to delegate to, with their providers.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text' as const, text: roster }] }),
  );

  // stdio only: the transport is the pipe agy opened to this process. Nothing may be
  // written to stdout except MCP frames, or the protocol desynchronizes.
  await server.connect(new StdioServerTransport());
}
