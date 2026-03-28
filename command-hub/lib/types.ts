// Shared TypeScript types — mirroring the Supabase schema.
// Keep these in sync with supabase/schema.sql.

export type CompanyStatus = "active" | "paused" | "archived" | "concept";

export type Company = {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  description: string | null;
  revenue: number;
  expenses: number;
  created_at: string;
};

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type Priority = "critical" | "high" | "medium" | "low";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  company_id: string | null;
  due_date: string | null;
  owner_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DraftStatus =
  | "idea"
  | "greenlit"
  | "owner_review"
  | "in_development"
  | "ready_to_market"
  | "shipped"
  | "killed";

export type DraftCard = {
  id: string;
  name: string;
  pitch: string | null;
  status: DraftStatus;
  owner: string | null;
  effort: string | null;
  revenue_category: string | null;
  projected_mrr: number | null;
  priority: Priority;
  tags: string[] | null;
  ip_notes: string | null;
  go_no_go: string | null;
  created_at: string;
};

export type MessageSender = "owner" | "9" | "system";
export type MessageChannel = "command_hub" | "telegram" | "imessage" | "email" | "voice";

export type Message = {
  id: string;
  sender: MessageSender;
  content: string;
  channel: MessageChannel;
  created_at: string;
};

export type DailyBriefing = {
  id: string;
  wins: string[];
  blockers: string[];
  recommended_actions: string[];
  created_at: string;
};
