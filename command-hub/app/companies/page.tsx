// Companies — Portfolio grid.
// Phase 1 shell: static seed data. Phase 2 pulls from Supabase companies table.

import type { Company } from "@/lib/types";

// Seed data matching the SQL seed in schema.sql.
// Replace with a Supabase fetch once creds are connected.
const SEED_COMPANIES: Omit<Company, "id" | "created_at">[] = [
  {
    name: "AiNFLGM",
    slug: "ainflgm",
    status: "active",
    description: "AI-powered NFL general manager simulation. The first public product.",
    revenue: 0,
    expenses: 0,
  },
  {
    name: "FreeAgent9",
    slug: "freeagent9",
    status: "active",
    description: "Real estate deals without realtors. Buyer + seller direct.",
    revenue: 0,
    expenses: 0,
  },
  {
    name: "Jules",
    slug: "jules",
    status: "concept",
    description: "AI scheduling assistant for Jamie. Internal pilot first.",
    revenue: 0,
    expenses: 0,
  },
  {
    name: "Rapid Mortgage",
    slug: "rapid",
    status: "active",
    description: "Mortgage origination — Cincinnati market. Existing revenue base.",
    revenue: 0,
    expenses: 0,
  },
];

const STATUS_COLORS: Record<string, string> = {
  active:   "var(--accent-green)",
  paused:   "var(--accent-amber)",
  archived: "var(--text-secondary)",
  concept:  "var(--accent-purple)",
};

export default function CompaniesPage() {
  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1
            className="text-xl font-bold tracking-widest uppercase"
            style={{ color: "var(--accent-cyan)" }}
          >
            Companies
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
            Portfolio overview. Revenue, burn, and status at a glance.
          </p>
        </div>
        <button
          disabled
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--accent-cyan)",
            color: "var(--accent-cyan)",
            borderRadius: "6px",
            padding: "6px 14px",
            fontSize: "0.75rem",
            cursor: "not-allowed",
            opacity: 0.6,
          }}
        >
          + Add Company
        </button>
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
      >
        {SEED_COMPANIES.map((company) => (
          <div key={company.slug} className="card p-5">
            {/* Header row */}
            <div className="flex items-start justify-between mb-3">
              <h2
                className="text-base font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                {company.name}
              </h2>
              <span
                style={{
                  fontSize: "0.65rem",
                  padding: "2px 8px",
                  borderRadius: "9999px",
                  border: `1px solid ${STATUS_COLORS[company.status] ?? "var(--border)"}`,
                  color: STATUS_COLORS[company.status] ?? "var(--text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {company.status}
              </span>
            </div>

            <p
              className="text-sm mb-4"
              style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
            >
              {company.description}
            </p>

            {/* Financials */}
            <div className="flex gap-4">
              <div>
                <div
                  className="text-xs uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  MRR
                </div>
                <div
                  className="text-sm font-bold"
                  style={{ color: "var(--accent-green)" }}
                >
                  ${company.revenue.toLocaleString()}
                </div>
              </div>
              <div>
                <div
                  className="text-xs uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Burn
                </div>
                <div
                  className="text-sm font-bold"
                  style={{ color: "var(--accent-amber)" }}
                >
                  ${company.expenses.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p
        className="text-xs mt-6"
        style={{ color: "var(--text-secondary)" }}
      >
        Data is static seed. Phase 2 connects this to the Supabase companies table.
      </p>
    </div>
  );
}
