import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MIN_AUDIO_BYTES = 1_500;

type DeepgramResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
};

function deepgramKey() {
  return process.env.DEEP_GRAM ?? process.env.DEEPGRAM_API_KEY ?? "";
}

export async function POST(request: Request) {
  try {
    const apiKey = deepgramKey();
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "deepgram_not_configured", message: "Deepgram is not configured for voice recording." },
        { status: 503 },
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: "invalid_audio", message: "Record a short voice command and try again." },
        { status: 400 },
      );
    }

    const audio = formData.get("audio");
    if (!(audio instanceof File) || audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { ok: false, error: "invalid_audio", message: "Record a short voice command and try again." },
        { status: 400 },
      );
    }

    if (audio.size < MIN_AUDIO_BYTES) {
      return NextResponse.json(
        { ok: false, error: "empty_transcript", message: "I could not hear a command in that recording." },
        { status: 422 },
      );
    }

    const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audio.type || "audio/webm",
      },
      body: await audio.arrayBuffer(),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const message = response.status === 400 || response.status === 408 || response.status === 422
        ? "I could not hear a command in that recording."
        : "Voice transcription is temporarily unavailable. Try again.";
      return NextResponse.json(
        { ok: false, error: "transcription_unavailable", message },
        { status: response.status === 400 || response.status === 408 || response.status === 422 ? 422 : 502 },
      );
    }

    const payload = (await response.json()) as DeepgramResponse;
    const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!transcript) {
      return NextResponse.json(
        { ok: false, error: "empty_transcript", message: "I could not hear a command in that recording." },
        { status: 422 },
      );
    }

    return NextResponse.json(
      { ok: true, transcript },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "transcription_failed", message: "Voice transcription failed. Try recording again." },
      { status: 500 },
    );
  }
}
