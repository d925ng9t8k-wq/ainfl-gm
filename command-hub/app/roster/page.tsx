// Roster — Team org chart.
// Shows 9 at the top, sub-agents and their roles below.
// Phase 2: pull from a dynamic agents table or config.

const ROSTER = [
  {
    tier: "Owner",
    members: [
      {
        name: "Jasson Fishback",
        role: "Owner / Founder",
        status: "active",
        note: "Vision, approvals, and final decisions.",
      },
    ],
  },
  {
    tier: "Front Office",
    members: [
      {
        name: "9",
        role: "AI Partner / Chief of Staff",
        status: "active",
        note: "Comms, orchestration, strategy. Always on.",
      },
      {
        name: "UNO",
        role: "Head of Ops (#1 sub-agent)",
        status: "active",
        note: "Execution lead. Outranks all sub-agents.",
      },
      {
        name: "Tee",
        role: "Engineering Team Lead (#2)",
        status: "active",
        note: "Code, tests, deployments, browser automation.",
      },
    ],
  },
  {
    tier: "Build Agents",
    members: [
      {
        name: "Code Agents",
        role: "Feature implementation, bug fixes",
        status: "on-demand",
        note: "Spawned by Tee for parallel build tasks.",
      },
      {
        name: "Test Agents",
        role: "Unit tests, integration tests, syntax validation",
        status: "on-demand",
        note: "Spawned by Tee after every change.",
      },
      {
        name: "Deployment Agents",
        role: "Build, bundle, deploy to Vercel / production",
        status: "on-demand",
        note: "Spawned by Tee for deployment tasks.",
      },
      {
        name: "Browser Automation Agents",
        role: "Playwright scripts, UI testing, scraping",
        status: "on-demand",
        note: "Spawned by Tee for browser tasks.",
      },
    ],
  },
];

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  active:    { color: "var(--accent-green)",  label: "Active"    },
  "on-demand": { color: "var(--accent-cyan)", label: "On-demand" },
  inactive:  { color: "var(--text-secondary)", label: "Inactive" },
};

export default function RosterPage() {
  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-xl font-bold tracking-widest uppercase"
          style={{ color: "var(--accent-cyan)" }}
        >
          Roster
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
          9 Enterprises org chart. Every player and their role.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {ROSTER.map((tier) => (
          <div key={tier.tier}>
            <h2
              className="text-xs uppercase tracking-widest mb-3 pb-1"
              style={{
                color: "var(--text-secondary)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {tier.tier}
            </h2>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
            >
              {tier.members.map((member) => {
                const style = STATUS_STYLES[member.status] ?? STATUS_STYLES.inactive;
                return (
                  <div key={member.name} className="card p-4">
                    <div className="flex items-start justify-between mb-1">
                      <span
                        className="font-bold"
                        style={{ color: "var(--text-primary)", fontSize: "0.9rem" }}
                      >
                        {member.name}
                      </span>
                      <span
                        style={{
                          fontSize: "0.6rem",
                          padding: "1px 7px",
                          borderRadius: "9999px",
                          border: `1px solid ${style.color}`,
                          color: style.color,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {style.label}
                      </span>
                    </div>
                    <div
                      className="text-xs mb-2"
                      style={{ color: "var(--accent-cyan)" }}
                    >
                      {member.role}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
                    >
                      {member.note}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
