#!/usr/bin/env node
/**
 * write-status-json.mjs
 * Pulls live data from the comms hub and session-handoff.json,
 * then writes command-hub/public/status.json for the dashboard.
 *
 * Run on a cron or call directly. Safe to run repeatedly.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUTPUT = join(ROOT, "command-hub", "public", "status.json");
const HANDOFF = join(ROOT, "memory", "session-handoff.json");
const HUB_URL = "http://localhost:3457/health";

async function fetchHub() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(HUB_URL, { signal: controller.signal });
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function readHandoff() {
  try {
    return JSON.parse(readFileSync(HANDOFF, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const [hub, handoff] = await Promise.all([fetchHub(), readHandoff()]);

  // --- Agent status from hub channels ---
  const channels = hub?.channels ?? {};
  const agentStatus = Object.entries(channels).map(([name, ch]) => ({
    name,
    status: ch.status,
    lastActivity: ch.lastActivity ?? null,
    messagesHandled: ch.messagesHandled ?? ch.callsHandled ?? 0,
  }));

  // --- Hub meta ---
  const hubMeta = hub
    ? {
        status: hub.status,
        terminalState: hub.terminalState,
        uptime: hub.uptime,
        heartbeatCount: hub.heartbeatCount,
        tunnelStatus: hub.tunnel?.status ?? "unknown",
      }
    : { status: "unreachable" };

  // --- Recent Telegram messages (last 10, inbound + outbound) ---
  const recentMessages = (hub?.recentMessages ?? [])
    .filter((m) => m.channel === "telegram")
    .slice(-10)
    .map((m) => ({
      direction: m.direction,
      text: m.text?.slice(0, 280) ?? "",
      timestamp: m.timestamp,
    }));

  // --- Running agents from session-handoff ---
  const knownAgentPatterns = [
    "comms-hub",
    "voice-server",
    "trader9-bot",
    "trinity-agent",
    "jules-telegram",
    "pilot-server",
    "session-handoff",
    "9-ops-daemon",
    "underwriter-api",
    "family-chat",
    "kids-mentor",
    "portfolio-notify",
    "usage-monitor",
    "ram-watch-agent",
  ];

  const runningAgents = (handoff?.runningProcesses ?? [])
    .map((line) => {
      const match = knownAgentPatterns.find((p) => line.includes(p));
      return match ?? null;
    })
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i) // dedupe
    .sort();

  const output = {
    generatedAt: new Date().toISOString(),
    hub: hubMeta,
    agentStatus,
    runningAgents,
    recentMessages,
    handoffGenerated: handoff?.generatedET ?? null,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`status.json written — ${runningAgents.length} agents, ${recentMessages.length} messages`);
}

main().catch((err) => {
  console.error("write-status-json failed:", err.message);
  process.exit(1);
});
