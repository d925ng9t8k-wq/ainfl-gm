/**
 * Model Constants — Single source of truth for all Claude model IDs.
 *
 * Apr 5, 2026 rule (reaffirmed): Haiku is BANNED from any quality-sensitive role.
 * Sonnet is the absolute minimum for voice, autonomous responders, named agents,
 * and any role where quality is in question. Opus is reserved for architecture,
 * strategy, and high-stakes decisions. Haiku is acceptable ONLY for mechanical
 * true/false health pings with zero reasoning component.
 *
 * To upgrade models across the entire system: change CLAUDE_QUALITY_MODEL here.
 * All voice, OC, agent, and specialist scripts import from this file.
 */

// Quality-sensitive roles: voice, autonomous responder, all named agents
export const CLAUDE_QUALITY_MODEL = "claude-sonnet-4-5";

// Highest-stakes decisions: architecture, strategy, Opus-level reasoning
export const CLAUDE_FLAGSHIP_MODEL = "claude-opus-4-20250514";

// Mechanical checks ONLY: true/false API health pings, billing probes, no reasoning
// DO NOT use for any role where content quality matters.
export const CLAUDE_PROBE_MODEL = "claude-haiku-4-5-20251001";
