import { createFileRoute } from "@tanstack/react-router";

import { lastQuestion, recordPresence } from "@/lib/interview.server";
import { analyzePresence } from "@/lib/vision.server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });

export const Route = createFileRoute("/api/presence")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        let body: { sessionId?: string; frames?: string[]; answer?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Invalid JSON body." }, 400);
        }

        if (!body.sessionId) return json({ error: "sessionId is required." }, 400);
        if (!Array.isArray(body.frames) || !body.frames.length) {
          return json({ error: "frames[] (data URLs) are required." }, 400);
        }

        try {
          const reading = await analyzePresence(body.frames, {
            topic: lastQuestion(body.sessionId).slice(0, 300),
            answer: body.answer ?? "",
          });
          recordPresence(body.sessionId, reading);
          return json({ reading });
        } catch (e) {
          const status = (e as { status?: number }).status ?? 500;
          return json(
            { error: e instanceof Error ? e.message : "Presence analysis failed." },
            status === 429 || status === 402 ? status : 500,
          );
        }
      },
    },
  },
});
