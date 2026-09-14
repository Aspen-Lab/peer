import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { PROVIDER_MODELS } from "@/lib/llm/provider-models";
import { canUseLocalServerProvider } from "@/lib/llm/providers/registry";

// The same order the provider walks: the chosen Gemini 3 pair on the global
// endpoint (the only one that serves them), then the configured region's
// 2.5 Flash-Lite as the last resort.
const GLOBAL_MODELS = [PROVIDER_MODELS.gemini.small, PROVIDER_MODELS.gemini.large];
const REGIONAL_MODELS = ["gemini-2.5-flash-lite"];

async function testModel(project: string, location: string, modelId: string): Promise<string> {
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });

  const result = await ai.models.generateContent({
    model: modelId,
    contents: "Reply with pong",
    config: { maxOutputTokens: 32 },
  });

  return (result.text ?? "").trim();
}

function classifyError(error: unknown): string {
  const msg = String(error);
  if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
    return "403 permission denied";
  }
  if (msg.includes("404") || msg.includes("NOT_FOUND")) {
    return "404 not found";
  }
  return msg.slice(0, 160);
}

export async function GET() {
  if (!canUseLocalServerProvider()) {
    // This diagnostic uses the developer's Vertex account directly. It must
    // never exist as a callable production/preview endpoint.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const project = process.env.GOOGLE_VERTEX_PROJECT;
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const regionalLocation = process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1";

  if (!project) {
    return NextResponse.json({ error: "GOOGLE_VERTEX_PROJECT not set" });
  }

  const results: Record<string, string> = {};

  for (const modelId of GLOBAL_MODELS) {
    const key = `global/${modelId}`;
    try {
      const text = await testModel(project, "global", modelId);
      if (text) {
        results[key] = "OK";
        return NextResponse.json({
          working: { location: "global", model: modelId, scope: "global" },
          credentials: creds ?? "not set",
          configuredLocation: regionalLocation,
          allResults: results,
          note: "Peer's Gemini 3 models answer from the global Vertex endpoint.",
        });
      }
      results[key] = "Empty response";
    } catch (err) {
      results[key] = classifyError(err);
    }
  }

  for (const modelId of REGIONAL_MODELS) {
    const key = `${regionalLocation}/${modelId}`;
    try {
      const text = await testModel(project, regionalLocation, modelId);
      if (text) {
        results[key] = "OK";
        return NextResponse.json({
          working: { location: regionalLocation, model: modelId, scope: "regional" },
          credentials: creds ?? "not set",
          configuredLocation: regionalLocation,
          allResults: results,
          note: "The Gemini 3 models did not answer; the configured region's 2.5 Flash-Lite still does.",
        });
      }
      results[key] = "Empty response";
    } catch (err) {
      results[key] = classifyError(err);
    }
  }

  return NextResponse.json({
    working: null,
    credentials: creds ?? "not set",
    configuredLocation: regionalLocation,
    allResults: results,
    suggestion: "No working model found. Check that Vertex AI API is enabled, the service account has Vertex AI User, and the configured region supports Peer’s Gemini model pair.",
  });
}
