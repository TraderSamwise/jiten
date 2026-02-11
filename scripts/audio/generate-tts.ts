/**
 * Generate TTS audio for words without recorded audio using Google Cloud WaveNet.
 *
 * Uses the REST API with an API key (GOOGLE_TTS_API_KEY env var).
 * Audio is cached in .cache/tts-audio/ to avoid redundant API calls.
 */

import * as fs from "fs";
import * as path from "path";

const TTS_API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const CACHE_DIR = path.resolve(__dirname, "..", "..", ".cache", "tts-audio");
const CONCURRENCY = 3;

interface TtsRequest {
  entryId: number;
  reading: string;
}

interface TtsResult {
  entryId: number;
  reading: string;
  audioData: Buffer;
}

/**
 * Generate TTS audio for a batch of entries.
 * Returns audio buffers for each successfully generated entry.
 */
export async function generateTts(requests: TtsRequest[]): Promise<TtsResult[]> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    console.log("  GOOGLE_TTS_API_KEY not set, skipping TTS generation");
    return [];
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  console.log(`  Generating TTS for ${requests.length} entries (concurrency: ${CONCURRENCY})...`);

  const results: TtsResult[] = [];
  let completed = 0;
  let cached = 0;
  let failed = 0;

  // Process in batches with concurrency control
  for (let i = 0; i < requests.length; i += CONCURRENCY) {
    const batch = requests.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (req) => {
        // Check cache first
        const cachePath = path.join(CACHE_DIR, `${req.entryId}.mp3`);
        if (fs.existsSync(cachePath)) {
          cached++;
          return {
            entryId: req.entryId,
            reading: req.reading,
            audioData: fs.readFileSync(cachePath),
          };
        }

        try {
          const audioData = await synthesize(apiKey, req.reading);
          // Cache the result
          fs.writeFileSync(cachePath, audioData);
          return {
            entryId: req.entryId,
            reading: req.reading,
            audioData,
          };
        } catch (err) {
          failed++;
          if (failed <= 5) {
            console.warn(`  TTS failed for entry ${req.entryId} (${req.reading}): ${err}`);
          }
          return null;
        }
      }),
    );

    for (const result of batchResults) {
      if (result) results.push(result);
    }

    completed += batch.length;
    if (completed % 1000 === 0 || completed === requests.length) {
      console.log(
        `  ${completed}/${requests.length} processed (${cached} cached, ${failed} failed)`,
      );
    }
  }

  console.log(
    `  TTS generation complete: ${results.length} audio files (${cached} from cache, ${failed} failures)`,
  );
  return results;
}

async function synthesize(apiKey: string, text: string): Promise<Buffer> {
  const body = {
    input: { text },
    voice: {
      languageCode: "ja-JP",
      name: "ja-JP-Neural2-B",
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 0.95,
    },
  };

  const res = await fetch(`${TTS_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`TTS API error ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as { audioContent: string };
  return Buffer.from(data.audioContent, "base64");
}
