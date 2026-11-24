import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "@/lib/gemini";
import { GeminiProvider, type CreateInteraction } from "@/lib/gemini/gemini";

const req = { system: "Be brief.", input: "{}", minItems: 2, maxItems: 4 };

describe("getProvider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off when GEMINI_API_KEY is missing", () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(getProvider()).toBeNull();
  });

  it("is off when AI_PROVIDER is off, even with a key", () => {
    vi.stubEnv("AI_PROVIDER", "off");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(getProvider()).toBeNull();
  });

  it("is off by default, even with a key", () => {
    vi.stubEnv("AI_PROVIDER", undefined);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(getProvider()).toBeNull();
  });

  it("is off for an unknown provider name", () => {
    vi.stubEnv("AI_PROVIDER", "other");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(getProvider()).toBeNull();
  });

  it("is Gemini with a key and AI_PROVIDER=gemini", () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(getProvider()?.name).toBe("gemini");
  });
});

describe("GeminiProvider", () => {
  it("asks the primary model for schema-shaped JSON without storing it", async () => {
    const create = vi.fn<CreateInteraction>(async () => ({ output_text: '{"sentences":["a","b"]}' }));
    const p = new GeminiProvider({ create, model: "m1", fallbackModel: "m2" });
    expect(await p.generate(req)).toBe('{"sentences":["a","b"]}');
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("m1");
    expect(params.store).toBe(false);
    expect(params.generation_config.thinking_level).toBe("low");
    expect(params.system_instruction).toBe("Be brief.");
    expect(params.response_format).toMatchObject({
      type: "text",
      mime_type: "application/json",
      schema: { type: "object", required: ["sentences"] },
    });
  });

  it("tries the fallback model when the primary fails", async () => {
    const create = vi
      .fn<CreateInteraction>()
      .mockRejectedValueOnce(Object.assign(new Error("rate"), { status: 429 }))
      .mockResolvedValueOnce({ output_text: "ok" });
    const p = new GeminiProvider({ create, model: "m1", fallbackModel: "m2" });
    expect(await p.generate(req)).toBe("ok");
    expect(create.mock.calls.map((c) => c[0].model)).toEqual(["m1", "m2"]);
  });

  it("throws when both models fail or return nothing", async () => {
    const create = vi.fn<CreateInteraction>(async () => ({}));
    const p = new GeminiProvider({ create, model: "m1", fallbackModel: "m2" });
    await expect(p.generate(req)).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
