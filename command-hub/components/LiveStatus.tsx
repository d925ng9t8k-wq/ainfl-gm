"use client";

import { useEffect, useState } from "react";

// ---- Types ----------------------------------------------------------------

interface ChannelStatus {
  name: string;
  status: string;
  lastActivity: string | null;
  messagesHandled: number;
}

interface RecentMessage {
  direction: "in" | "out";
  text: string;
  timestamp: string;
}

interface StatusData {
  generatedAt: string;
  hub: {
    status: string;
    terminalState: string;
    uptime: number;
    heartbeatCount: number;
    tunnelStatus: string;
  };
  agentStatus: ChannelStatus[];
  runningAgents: string[];
  recentMessages: RecentMessage[];
  handoffGenerated: string | null;
}

// ---- Helpers ---------------------------------------------------------------

function statusColor(s: string): string {
  if (s === "active" || s === "running" || s === "healthy") return "var(--accent-green)";
  if (s === "stale") return "var(--accent-amber)";
  if (s === "unreachable" || s === "error") return "var(--accent-red)";
  return "var(--text-secondary)";
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/New_York" }) + " ET";
}

function formatRelative(iso: string | null): string {
  if (!iso) return "--";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---- Component -------------------------------------------------------------

export default function LiveStatus() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  async function fetchStatus() {
    try {
      // Cache-busting query param so Cloudflare Pages always returns fresh file
      const res = await fetch(`/status.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StatusData = await res.json();
      setData(json);
      setLastFetch(new Date());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "fetch failed");
    }
  }

  useEffect(() => {
    fetchStatus();
    // Refresh every 60 seconds — matches the cron cadence
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="card p-4" style={{ borderColor: "var(--accent-red)" }}>
        <p style={{ color: "var(--accent-red)", fontSize: "0.8rem" }}>
          Live status unavailable — {error}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card p-4">
        <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>Loading status...</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* ---- Hub Meta Row ---- */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs uppercase tracking-widest" style={{ color: "var(--accent-cyan)" }}>
            Comms Hub
          </h2>
          <span
            className="text-xs"
            style={{ color: "var(--text-secondary)" }}
            title={`status.json generated at ${data.generatedAt}`}
          >
            {lastFetch ? `refreshed ${formatRelative(lastFetch.toISOString())}` : ""}
          </span>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          {[
            { label: "Hub",      value: data.hub.status,        color: statusColor(data.hub.status) },
            { label: "Terminal", value: data.hub.terminalState,  color: data.hub.terminalState === "relay" ? "var(--accent-green)" : "var(--accent-amber)" },
            { label: "Tunnel",   value: data.hub.tunnelStatus,   color: statusColor(data.hub.tunnelStatus) },
            { label: "Uptime",   value: formatUptime(data.hub.uptime), color: "var(--text-primary)" },
            { label: "Heartbeats", value: String(data.hub.heartbeatCount), color: "var(--text-primary)" },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ color: item.color, fontWeight: "bold", fontSize: "0.9rem" }}>{item.value}</div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2px" }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Two column: channels + agents ---- */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Channel Status */}
        <div className="card p-4">
          <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--accent-purple)" }}>
            Channels
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
            <thead>
              <tr>
                {["Channel", "Status", "Last Activity", "Msgs"].map((h) => (
                  <th key={h} style={{ textAlign: "left", color: "var(--text-secondary)", paddingBottom: "6px", fontWeight: "normal", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.agentStatus.map((ch) => (
                <tr key={ch.name} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "5px 0", textTransform: "capitalize" }}>{ch.name}</td>
                  <td>
                    <span style={{ color: statusColor(ch.status) }}>{ch.status}</span>
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>{formatRelative(ch.lastActivity)}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{ch.messagesHandled.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Running Agents */}
        <div className="card p-4">
          <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--accent-green)" }}>
            Agents Running ({data.runningAgents.length})
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {data.runningAgents.map((agent) => (
              <span
                key={agent}
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--accent-green)",
                  color: "var(--accent-green)",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "0.7rem",
                  fontFamily: "inherit",
                }}
              >
                {agent}
              </span>
            ))}
          </div>
          {data.handoffGenerated && (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.65rem", marginTop: "12px" }}>
              Snapshot: {data.handoffGenerated}
            </p>
          )}
        </div>
      </div>

      {/* ---- Recent Telegram Messages ---- */}
      <div className="card p-4">
        <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--accent-amber)" }}>
          Recent Telegram
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {data.recentMessages.length === 0 && (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>No messages in snapshot.</p>
          )}
          {data.recentMessages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "flex-start",
                borderBottom: i < data.recentMessages.length - 1 ? "1px solid var(--border)" : "none",
                paddingBottom: i < data.recentMessages.length - 1 ? "8px" : "0",
              }}
            >
              {/* Direction badge */}
              <span
                style={{
                  flexShrink: 0,
                  fontSize: "0.65rem",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: msg.direction === "in" ? "var(--accent-cyan)" : "var(--bg-elevated)",
                  color: msg.direction === "in" ? "var(--bg-base)" : "var(--text-secondary)",
                  border: msg.direction === "out" ? "1px solid var(--border)" : "none",
                  marginTop: "2px",
                }}
              >
                {msg.direction === "in" ? "YOU" : " 9 "}
              </span>
              {/* Message text */}
              <span style={{ flex: 1, fontSize: "0.78rem", color: "var(--text-primary)", lineHeight: 1.4 }}>
                {msg.text}
              </span>
              {/* Timestamp */}
              <span
                style={{ flexShrink: 0, fontSize: "0.65rem", color: "var(--text-secondary)", marginTop: "3px" }}
                title={msg.timestamp}
              >
                {formatTime(msg.timestamp)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
