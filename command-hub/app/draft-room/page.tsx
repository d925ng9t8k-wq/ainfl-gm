// Draft Room — full-page Kanban for ideas → shipped.
// Phase 1 shell: static columns and one seed card per column.
// Phase 2 wires to Supabase draft_room table with drag-and-drop.

import type { DraftStatus } from "@/lib/types";

const COLUMNS: { id: DraftStatus; label: string; color: string }[] = [
  { id: "idea",             label: "Idea Stage",       color: "var(--text-secondary)"  },
  { id: "greenlit",         label: "Greenlit",          color: "var(--accent-green)"    },
  { id: "owner_review",     label: "Owner Review",      color: "var(--accent-amber)"    },
  { id: "in_development",   label: "In Development",    color: "var(--accent-cyan)"     },
  { id: "ready_to_market",  label: "Ready to Market",   color: "var(--accent-purple)"   },
];

const SEED_CARDS: {
  id: string;
  name: string;
  pitch: string;
  status: DraftStatus;
  owner: string;
  effort: string;
  projected_mrr: number | null;
  priority: string;
}[] = [
  {
    id: "1",
    name: "AiNFLGM AdSense",
    pitch: "Enable Google AdSense on AiNFLGM for passive ad revenue",
    status: "greenlit",
    owner: "Tee",
    effort: "1 day",
    projected_mrr: 200,
    priority: "high",
  },
  {
    id: "2",
    name: "Jules MVP",
    pitch: "AI scheduling assistant — internal pilot with Jamie",
    status: "idea",
    owner: "9",
    effort: "2 weeks",
    projected_mrr: null,
    priority: "medium",
  },
  {
    id: "3",
    name: "FreeAgent9 Landing",
    pitch: "Public-facing landing page with waitlist capture",
    status: "in_development",
    owner: "Tee",
    effort: "3 days",
    projected_mrr: null,
    priority: "high",
  },
  {
    id: "4",
    name: "DraftKings Affiliate Integration",
    pitch: "BetMGM/FanDuel affiliate links on AiNFLGM — Phase 2 monetization",
    status: "owner_review",
    owner: "9",
    effort: "1 week",
    projected_mrr: 1500,
    priority: "high",
  },
  {
    id: "5",
    name: "AI Underwriter POC",
    pitch: "RAG-based FHA guideline lookup for Rapid Mortgage",
    status: "idea",
    owner: "9",
    effort: "2-3 days",
    projected_mrr: null,
    priority: "medium",
  },
];

function DraftCard({ card }: { card: typeof SEED_CARDS[number] }) {
  return (
    <div
      className="card p-3 mb-2"
      style={{ cursor: "default" }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span
          className="text-sm font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          {card.name}
        </span>
        <span
          style={{
            fontSize: "0.6rem",
            padding: "1px 6px",
            borderRadius: "9999px",
            background:
              card.priority === "critical" ? "var(--accent-red)" :
              card.priority === "high"     ? "var(--accent-amber)" :
              "var(--border)",
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          {card.priority}
        </span>
      </div>

      <p
        className="text-xs mb-2"
        style={{ color: "var(--text-secondary)", lineHeight: 1.4 }}
      >
        {card.pitch}
      </p>

      <div className="flex items-center justify-between text-xs">
        <span style={{ color: "var(--text-secondary)" }}>
          Owner: <span style={{ color: "var(--accent-cyan)" }}>{card.owner}</span>
        </span>
        <span style={{ color: "var(--text-secondary)" }}>{card.effort}</span>
      </div>

      {card.projected_mrr != null && (
        <div
          className="text-xs mt-1"
          style={{ color: "var(--accent-green)" }}
        >
          ~${card.projected_mrr.toLocaleString()} /mo projected
        </div>
      )}

      {/* Send to 9 button — Phase 2 wires this */}
      <button
        disabled
        className="w-full text-xs mt-2 py-1 rounded"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          cursor: "not-allowed",
        }}
      >
        Send to 9 for Analysis
      </button>
    </div>
  );
}

export default function DraftRoomPage() {
  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1
            className="text-xl font-bold tracking-widest uppercase"
            style={{ color: "var(--accent-cyan)" }}
          >
            Draft Room
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
            Ideas move left to right. Owner reviews before In Development.
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
          + New Card
        </button>
      </div>

      {/* Kanban board */}
      <div
        className="flex gap-4 overflow-x-auto pb-4"
        style={{ alignItems: "flex-start" }}
      >
        {COLUMNS.map((col) => {
          const cards = SEED_CARDS.filter((c) => c.status === col.id);
          return (
            <div
              key={col.id}
              style={{
                minWidth: "240px",
                flex: "0 0 240px",
              }}
            >
              {/* Column header */}
              <div
                className="flex items-center justify-between mb-3 px-1"
              >
                <span
                  className="text-xs uppercase tracking-widest font-bold"
                  style={{ color: col.color }}
                >
                  {col.label}
                </span>
                <span
                  className="text-xs"
                  style={{
                    background: "var(--bg-elevated)",
                    padding: "1px 7px",
                    borderRadius: "9999px",
                    color: "var(--text-secondary)",
                  }}
                >
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "8px",
                  minHeight: "120px",
                }}
              >
                {cards.length === 0 ? (
                  <p
                    className="text-xs text-center py-4"
                    style={{ color: "var(--border)" }}
                  >
                    empty
                  </p>
                ) : (
                  cards.map((card) => (
                    <DraftCard key={card.id} card={card} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
        Drag-and-drop and live DB sync wire up in Phase 2.
      </p>
    </div>
  );
}
