// Mission Control — the first thing Owner sees.
// Phase 1 shell: KPI strip, daily briefing widget, task list, chat prompt.
// Phase 2 will wire these to live Supabase data + real-time subscriptions.

import LiveStatus from "@/components/LiveStatus";

export default function MissionControlPage() {
  return (
    <div>
      {/* Page title */}
      <div className="mb-6">
        <h1
          className="text-xl font-bold tracking-widest uppercase"
          style={{ color: "var(--accent-cyan)" }}
        >
          Mission Control
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
          Live status. Today's priorities. Direct line to 9.
        </p>
      </div>

      {/* KPI Strip */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
      >
        {[
          { label: "Active Companies", value: "4",     color: "var(--accent-cyan)"   },
          { label: "Total MRR",        value: "$0",    color: "var(--accent-green)"  },
          { label: "Monthly Burn",     value: "$--",   color: "var(--accent-amber)"  },
          { label: "Runway",           value: "--",    color: "var(--text-primary)"  },
          { label: "North Star",       value: "0%",    color: "var(--accent-purple)" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="card p-4"
          >
            <div
              className="text-2xl font-bold"
              style={{ color: kpi.color }}
            >
              {kpi.value}
            </div>
            <div
              className="text-xs uppercase tracking-widest mt-1"
              style={{ color: "var(--text-secondary)" }}
            >
              {kpi.label}
            </div>
          </div>
        ))}
      </div>

      {/* Two-column: Briefing + Tasks */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Daily Briefing */}
        <div className="card p-4">
          <h2
            className="text-xs uppercase tracking-widest mb-3"
            style={{ color: "var(--accent-purple)" }}
          >
            Daily Briefing from 9
          </h2>

          <div className="mb-3">
            <div
              className="text-xs font-bold mb-1"
              style={{ color: "var(--accent-green)" }}
            >
              Wins
            </div>
            <ul style={{ color: "var(--text-secondary)", fontSize: "0.8rem", paddingLeft: "1rem" }}>
              <li>Command Hub scaffolded — Phase 1 ready to build</li>
              <li>Supabase schema live with all five tables</li>
            </ul>
          </div>

          <div className="mb-3">
            <div
              className="text-xs font-bold mb-1"
              style={{ color: "var(--accent-amber)" }}
            >
              Blockers
            </div>
            <ul style={{ color: "var(--text-secondary)", fontSize: "0.8rem", paddingLeft: "1rem" }}>
              <li>No live data yet — real-time APIs pending Phase 2</li>
            </ul>
          </div>

          <div>
            <div
              className="text-xs font-bold mb-1"
              style={{ color: "var(--accent-cyan)" }}
            >
              Recommended Actions
            </div>
            <ol style={{ color: "var(--text-secondary)", fontSize: "0.8rem", paddingLeft: "1rem" }}>
              <li>Connect Supabase project and run npm install</li>
              <li>Assign Phase 1 task owners in Draft Room</li>
              <li>Review branding on Mission Control before sharing</li>
            </ol>
          </div>
        </div>

        {/* Today's Tasks */}
        <div className="card p-4">
          <h2
            className="text-xs uppercase tracking-widest mb-3"
            style={{ color: "var(--accent-cyan)" }}
          >
            Today's Priorities
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {[
              { label: "Connect Supabase project",              priority: "critical" },
              { label: "Build Mission Control live data layer",  priority: "high"     },
              { label: "Wire Draft Room kanban to DB",           priority: "high"     },
              { label: "Add Owner auth (Supabase Auth)",         priority: "medium"   },
            ].map((task) => (
              <li
                key={task.label}
                className="flex items-start gap-2 py-2"
                style={{ borderBottom: "1px solid var(--border)", fontSize: "0.8rem" }}
              >
                {/* Checkbox placeholder — Phase 1 will wire this to Supabase */}
                <input
                  type="checkbox"
                  className="mt-0.5"
                  style={{ accentColor: "var(--accent-cyan)" }}
                  readOnly
                />
                <span style={{ flex: 1, color: "var(--text-primary)" }}>{task.label}</span>
                <span
                  style={{
                    fontSize: "0.65rem",
                    padding: "1px 6px",
                    borderRadius: "9999px",
                    background:
                      task.priority === "critical" ? "var(--accent-red)" :
                      task.priority === "high"     ? "var(--accent-amber)" :
                      "var(--border)",
                    color: "var(--text-primary)",
                  }}
                >
                  {task.priority}
                </span>
              </li>
            ))}
          </ul>
          <p
            className="text-xs mt-3"
            style={{ color: "var(--text-secondary)" }}
          >
            Checkboxes are visual only until Phase 1 wires them to Supabase.
          </p>
        </div>
      </div>

      {/* Live Status — agent health, channels, recent messages */}
      <div className="mb-6">
        <LiveStatus />
      </div>

      {/* Command Prompt — direct line to 9 */}
      <div className="card p-4">
        <h2
          className="text-xs uppercase tracking-widest mb-3"
          style={{ color: "var(--accent-cyan)" }}
        >
          Command Prompt — direct line to 9
        </h2>
        <div
          className="rounded p-3 mb-3"
          style={{
            background: "var(--bg-elevated)",
            minHeight: "80px",
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
          }}
        >
          {/* Phase 2: live chat messages render here */}
          <span style={{ color: "var(--border)" }}>
            [Chat history loads here in Phase 2]
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Type a message to 9..."
            disabled
            style={{
              flex: 1,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "8px 12px",
              color: "var(--text-primary)",
              fontSize: "0.8rem",
            }}
          />
          <button
            disabled
            style={{
              background: "var(--accent-cyan)",
              color: "var(--bg-base)",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "0.8rem",
              fontWeight: "bold",
              cursor: "not-allowed",
              opacity: 0.5,
            }}
          >
            Send
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
          Live chat wires up in Phase 2 (Supabase realtime + 9 webhook).
        </p>
      </div>
    </div>
  );
}
