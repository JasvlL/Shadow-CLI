/**
 * UsageOverlay
 *
 * A full-screen overlay (like Claude's /usage panel) that:
 *  - Replaces the entire app render when open — no inline rendering that
 *    disturbs the chat scroll.
 *  - Shows 6 bars: Claude CLI session+week, Agy Gemini weekly+5h,
 *    Agy Claude/GPT weekly+5h.
 *  - Fetches real quota data from CLI stored files / process spawns.
 *  - Refreshes automatically every 30s while open.
 *  - Closes on Esc or 'q'.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AppState } from './state.js';
import { loadGlobalUsage, fetchLiveQuota, getCachedQuota } from '@shadow/core';
import type { LiveQuotaData, QuotaBar } from '@shadow/core';

export interface UsageOverlayProps {
  usage: AppState['usage'];
  onClose: () => void;
}

// ─────────────────────────── Sub-components ─────────────────────────────────

function BarRow({ bar, width = 36 }: { bar: QuotaBar; width?: number }) {
  const filled = Math.round((Math.min(100, bar.pct) / 100) * width);
  const empty = width - filled;
  const fillChar = '█';
  const emptyChar = '░';

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      <Text>{bar.label}</Text>
      <Box>
        <Text>[</Text>
        <Text color={bar.color}>{fillChar.repeat(filled)}</Text>
        <Text color="gray">{emptyChar.repeat(empty)}</Text>
        <Text>] </Text>
        <Text bold>{bar.pct.toFixed(2)}%</Text>
      </Box>
      <Text color={bar.color === 'red' ? 'red' : 'green'} dimColor>
        {'  '}{bar.detail}
      </Text>
    </Box>
  );
}

function SectionHeader({ title, provider }: { title: string; provider: string }) {
  const color = provider === 'claude' ? 'blueBright' : 'greenBright';
  return (
    <Box marginTop={1} marginBottom={0}>
      <Text bold color={color}>{title}</Text>
    </Box>
  );
}

function SessionRow({ label, value }: { label: string; value: string }) {
  return (
    <Box marginLeft={2}>
      <Text dimColor>{label.padEnd(28)}</Text>
      <Text>{value}</Text>
    </Box>
  );
}

// ─────────────────────────── Main overlay ───────────────────────────────────

export function UsageOverlay({ usage, onClose }: UsageOverlayProps) {
  const [quotaData, setQuotaData] = useState<LiveQuotaData | null>(getCachedQuota);
  const [fetching, setFetching] = useState(false);
  const [lastFetch, setLastFetch] = useState<string>('');

  // Fetch live data when overlay opens, then every 30s
  const doFetch = () => {
    if (fetching) return;
    setFetching(true);
    // Read Agy tokens from the global tracker + current session
    const globalNow = loadGlobalUsage();
    const sessAgy = usage.get('agy') ?? { input: 0, output: 0 };
    const agyWeeklyTokens = globalNow.agy.input + globalNow.agy.output;
    const agySessionTokens = sessAgy.input + sessAgy.output;

    fetchLiveQuota({ agyWeeklyTokens, agySessionTokens })
      .then((d) => {
        setQuotaData(d);
        setLastFetch(new Date().toLocaleTimeString());
      })
      .catch(() => {/* keep existing */})
      .finally(() => setFetching(false));
  };

  useEffect(() => {
    doFetch();
    const id = setInterval(doFetch, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((_ch, key) => {
    if (key.escape || _ch === 'q') onClose();
    if (_ch === 'r') doFetch();
  });

  // ─── Session stats from in-process tracker ───────────────────────────────
  const global = loadGlobalUsage();
  const sessionClaude = usage.get('claude') ?? { input: 0, output: 0 };
  const sessionAgy = usage.get('agy') ?? { input: 0, output: 0 };

  const claudeSessionCost =
    (sessionClaude.input * 3 / 1_000_000) + (sessionClaude.output * 15 / 1_000_000);
  const agySessionCost =
    (sessionAgy.input * 3.5 / 1_000_000) + (sessionAgy.output * 10.5 / 1_000_000);
  const claudeLifetimeCost = global.claude.costEstimate + claudeSessionCost;
  const agyLifetimeCost = global.agy.costEstimate + agySessionCost;

  // ─── Determine which sections to display ─────────────────────────────────
  // We always show Shadow's own tracked session cost.
  // The live CLI quota bars come from quotaData if available.
  const sections = quotaData?.sections ?? [];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyanBright"
      paddingX={2}
      paddingY={1}
      width={70}
    >
      {/* ── Header ── */}
      <Box justifyContent="space-between">
        <Text bold color="cyanBright">  Models &amp; Quota</Text>
        <Text dimColor>{fetching ? 'fetching…' : lastFetch ? `updated ${lastFetch}` : ''}</Text>
      </Box>

      {/* ── Shadow session tracker (always available) ── */}
      <SectionHeader title="SHADOW SESSION" provider="claude" />
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <SessionRow label="Claude cost (this session):" value={`$${claudeSessionCost.toFixed(4)}`} />
        <SessionRow label="Claude tokens in / out:" value={`${sessionClaude.input.toLocaleString()} / ${sessionClaude.output.toLocaleString()}`} />
        <SessionRow label="Agy cost (this session):" value={`$${agySessionCost.toFixed(4)}`} />
        <SessionRow label="Agy tokens in / out:" value={`${sessionAgy.input.toLocaleString()} / ${sessionAgy.output.toLocaleString()}`} />
        <SessionRow label="Claude lifetime cost:" value={`$${claudeLifetimeCost.toFixed(4)}`} />
        <SessionRow label="Agy lifetime cost:" value={`$${agyLifetimeCost.toFixed(4)}`} />
      </Box>

      {/* ── Live CLI quota bars ── */}
      {sections.length > 0 ? (
        sections.map((sec) => (
          <Box key={sec.section} flexDirection="column">
            <SectionHeader title={sec.section} provider={sec.provider} />
            {sec.bars.length === 0 ? (
              <Box marginLeft={2}>
                <Text dimColor>No quota data available for this section.</Text>
              </Box>
            ) : (
              sec.bars.map((bar) => <BarRow key={bar.label} bar={bar} />)
            )}
          </Box>
        ))
      ) : (
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {fetching ? (
            <Text dimColor>Fetching quota from Claude CLI and Agy…</Text>
          ) : (
            <>
              <Text dimColor>
                Live quota bars not available.
              </Text>
              <Text dimColor>
                Claude CLI stores quota in ~/.claude/ (requires Claude Pro plan).
              </Text>
              <Text dimColor>
                Agy quota requires agy to be signed in and responsive.
              </Text>
              <Text dimColor>Press <Text bold>r</Text> to retry fetching.</Text>
            </>
          )}
        </Box>
      )}

      {/* ── Stale warning ── */}
      {quotaData?.stale && (
        <Box marginTop={1} marginLeft={2}>
          <Text color="yellow" dimColor>⚠ Showing cached data — {quotaData.stale}</Text>
        </Box>
      )}

      {/* ── Footer ── */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>esc/q  Close  ·  r  Refresh quota</Text>
      </Box>
    </Box>
  );
}
