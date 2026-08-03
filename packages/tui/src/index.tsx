import React from 'react';
import { render } from 'ink';
import type { ProviderId } from '@shadow/providers';
import { SessionLog } from '@shadow/core';
import { App } from './App.js';

export * from './state.js';
export * from './completion.js';
export * from './mentions.js';
export * from './history.js';
export * from './approval-server.js';
export { App, type AppProps } from './App.js';
export { Prompt, type PromptProps } from './Prompt.js';

export interface StartOptions {
  cwd: string;
  provider: ProviderId;
  model?: string;
  session: SessionLog;
  resume: boolean;
  version?: string;
}

export async function startTui(opts: StartOptions): Promise<void> {
  const instance = render(
    <App
      cwd={opts.cwd}
      provider={opts.provider}
      model={opts.model}
      session={opts.session}
      resume={opts.resume}
      version={opts.version}
    />,
  );
  await instance.waitUntilExit();
}
