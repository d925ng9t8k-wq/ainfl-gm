// Log — Activity feed. All significant events across the system.
// Phase 1 shell: static seed entries. Phase 2 pulls from Supabase messages table
// and auto-appends task completions, deploys, and briefing events.

const SEED_LOG = [
  {
    id: "1",
    timestamp: "2026-03-27T18:00:00Z",
    actor: "Tee",
    event: "Command Hub scaffolded — Next.js 15 + Supabase schema created",
    type: "deploy",
  },
  {
    id: "2",
    timestamp: "2026-03-27T12:00:00Z",
    actor: "9",
    event: "Dashboard v6 requirements filed by Owner. Full-stack build authorized.",
    type: "decision",
  },
  {
    id: "3",
    timestamp: "2026-03-27T09:00:00Z",
    actor: "9",
    event: "Daily briefing generated — wins: 2, blockers: 1, actions: 3",
    type: "briefing",
  },
  {
    id: "4",
    timestamp: "2026-03-27T08:30:00Z",
    actor: "Jasson",
    event: "Owner reviewed dashboard v5. Verdict: prototype only. Full rebuild ordered.",
    type: "decision",
  },
  {
    id: "5",
    timestamp: "2026-03-26T21:00:00Z",
    actor: "9",
    event: "Dashboard v5 deployed to public/dashboard.html",
    type: "deploy",
  },
];

const TYPE_COLORS: Record<string, string> = {
  deploy:   "var(--accent-cyan)",
  decision: "var(--accent-purple)",
  briefing: "var(--accent-green)",
  alert:    "var(--accent-red)",
  message:  "var(--text-secondary)",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

export default function LogPage() {
  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-xl font-bold tracking-widest uppercase"
          style={{ color: "var(--accent-cyan)" }}
        >
          Log
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
          Audit trail. Every decision, deploy, and briefing — in order.
        </p>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {SEED_LOG.map((entry, i) => (
          <div
            key={entry.id}
            className="flex gap-4 px-4 py-3"
            style={{
              borderBottom:
                i < SEED_LOG.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            {/* Type dot */}
            <div className="flex flex-col items-center pt-1">
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: TYPE_COLORS[entry.type] ?? "var(--text-secondary)",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-0.5">
                <span
                  className="text-xs font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {entry.actor}
                </span>
                <span
                  style={{
                    fontSize: "0.6rem",
                    padding: "1px 6px",
                    borderRadius: "9999px",
                    border: `1px solid ${TYPE_COLORS[entry.type] ?? "var(--border)"}`,
                    color: TYPE_COLORS[entry.type] ?? "var(--text-secondary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {entry.type}
                </span>
              </div>
              <p
                className="text-sm"
                style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
              >
                {entry.event}
              </p>
            </div>

            {/* Timestamp — right-aligned */}
            <div
              className="text-xs whitespace-nowrap"
              style={{ color: "var(--text-secondary)", paddingTop: "2px" }}
            >
              {formatTimestamp(entry.timestamp)}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs mt-4" style={{ color: "var(--text-secondary)" }}>
        Static seed data. Phase 2 streams live events from Supabase.
      </p>
    </div>
  );
}
