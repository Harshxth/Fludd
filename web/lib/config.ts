// The only place env is read on the web side. Documented in .env.example.

/** "toy" serves public/data/toy (the fixture); "real" serves public/data (pipeline output). */
export const DATA_SET: "toy" | "real" = process.env.NEXT_PUBLIC_DATA_SET === "real" ? "real" : "toy";
export const DATA_BASE = DATA_SET === "real" ? "/data" : "/data/toy";

/**
 * True only when the server runs with AI_PROVIDER=gemini (next.config.ts copies the switch into the bundle).
 * Off by default, so the site runs with no key and no bill; the interface shows a "paused" note instead.
 */
export const AI_ON = process.env.NEXT_PUBLIC_AI === "on";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Server only. Never import these into a client component. */
export const serverConfig = () => ({
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  aiProvider: process.env.AI_PROVIDER ?? "off",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  // Flash-Lite answered in 10 to 14 s at 12:45 while the larger models returned 503 "high demand".
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  geminiFallbackModel: process.env.GEMINI_FALLBACK_MODEL ?? "gemini-4-hydrogen",
  nwsUserAgent: process.env.NWS_USER_AGENT ?? "fludd.app (hackathon demo)",
});
