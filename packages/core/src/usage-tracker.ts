import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SHADOW_DIR = path.join(os.homedir(), '.shadow');
const USAGE_FILE = path.join(SHADOW_DIR, 'usage.json');

export interface ProviderUsage {
  input: number;
  output: number;
  cacheRead: number;
  costEstimate: number; // in USD
}

export interface GlobalUsage {
  claude: ProviderUsage;
  agy: ProviderUsage;
}

const DEFAULT_USAGE: GlobalUsage = {
  claude: { input: 0, output: 0, cacheRead: 0, costEstimate: 0 },
  agy: { input: 0, output: 0, cacheRead: 0, costEstimate: 0 }
};

// Claude 3.5 Sonnet: $3 / 1M input, $15 / 1M output. 
// Gemini 1.5 Pro: $3.5 / 1M input, $10.5 / 1M output.
const PRICING = {
  claude: { input: 3 / 1000000, output: 15 / 1000000 },
  agy: { input: 3.5 / 1000000, output: 10.5 / 1000000 }
};

export function loadGlobalUsage(): GlobalUsage {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const data = fs.readFileSync(USAGE_FILE, 'utf8');
      return JSON.parse(data) as GlobalUsage;
    }
  } catch (e) {
    // Ignore read errors
  }
  return DEFAULT_USAGE;
}

export function saveGlobalUsage(usage: GlobalUsage) {
  try {
    if (!fs.existsSync(SHADOW_DIR)) {
      fs.mkdirSync(SHADOW_DIR, { recursive: true });
    }
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2), 'utf8');
  } catch (e) {
    // Ignore write errors
  }
}

export function recordUsage(provider: 'claude' | 'agy', inputTokens: number, outputTokens: number, cacheReadTokens: number = 0) {
  const usage = loadGlobalUsage();
  
  usage[provider].input += inputTokens;
  usage[provider].output += outputTokens;
  usage[provider].cacheRead += cacheReadTokens;

  // Update cost estimate
  const cost = (inputTokens * PRICING[provider].input) + (outputTokens * PRICING[provider].output);
  usage[provider].costEstimate += cost;

  saveGlobalUsage(usage);
  return usage;
}
