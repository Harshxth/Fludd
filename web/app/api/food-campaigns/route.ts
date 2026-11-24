// Food distribution campaigns near Tampa, found by a search agent (Gemini + Google Search grounding).
// GET /api/food-campaigns -> { campaigns, sources, fetchedAt }. Cached in memory for 6 hours per server instance,
// so one search serves everyone and the key is never hit per visitor.
import { GoogleGenAI } from "@google/genai";
import { connection } from "next/server";
import { apiError } from "@/lib/api";
import { serverConfig } from "@/lib/config";
import { findFoodCampaigns, type Campaign, type SearchAnswer } from "@/lib/food/campaigns";
import { describeError } from "@/lib/gemini/gemini";

const CACHE_MS = 6 * 3_600_000;
let cache: { at: number; body: { campaigns: Campaign[]; sources: SearchAnswer["sources"]; fetchedAt: string } } | null = null;

export async function GET() {
  // Ask at request time, never at build time (a build has no reason to spend search quota).
  await connection();
  if (cache && Date.now() - cache.at < CACHE_MS) return Response.json(cache.body);
  const cfg = serverConfig();
  // Search grounding has its own, smaller quota: prefer the second key when one is set (added in Vercel as "Gemini_api_key_2").
  const apiKey = process.env.Gemini_api_key_2 || process.env.GEMINI_API_KEY_2 || cfg.geminiApiKey;
  if (cfg.aiProvider !== "gemini" || !apiKey) return apiError(503, "not_configured", "The search agent is not set up on this server");
  const ai = new GoogleGenAI({ apiKey });
  const ask = async (prompt: string): Promise<SearchAnswer> => {
    let last: unknown = null;
    for (const model of [cfg.geminiModel, cfg.geminiFallbackModel]) {
      try {
        const res = await ai.models.generateContent({ model, contents: prompt, config: { tools: [{ googleSearch: {} }], temperature: 0 } });
        const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        return {
          text: res.text ?? "",
          sources: chunks.flatMap((c) => (c.web?.uri ? [{ title: c.web.title ?? "Source", uri: c.web.uri }] : [])),
        };
      } catch (e) {
        last = e;
        console.warn(`[food-campaigns] ${model} failed (${describeError(e)})`);
      }
    }
    throw last ?? new Error("no model");
  };
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const found = await findFoodCampaigns(ask, today);
    const body = { ...found, fetchedAt: new Date().toISOString() };
    cache = { at: Date.now(), body };
    return Response.json(body);
  } catch {
    return apiError(502, "upstream_error", "The search agent is unavailable right now");
  }
}
