import { createFileRoute } from "@tanstack/react-router";

import type { Dossier } from "@/lib/interview-core";

type Body = {
  sessionId?: string;
  candidate?: unknown;
  message?: string;
  dossier?: Dossier | null;
};


const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

export const Route = createFileRoute("/api/interview")({
  server: {
    handlers: {
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!sessionId) return json({ error: "sessionId is required" }, 400);

        const { startInterview, continueInterview } = await import("@/lib/interview.server");

        try {
          if (body.candidate) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return json(await startInterview(sessionId, body.candidate as any));
          }
          if (typeof body.message === "string" && body.message.trim()) {
            return json(await continueInterview(sessionId, body.message.trim()));
          }
          return json({ error: "Provide either `candidate` (to start) or `message`." }, 400);
        } catch (err) {
          const status = (err as { status?: number }).status ?? 500;
          const message = err instanceof Error ? err.message : "Interview failed";
          if (status === 429) return json({ error: "Rate limited. Please retry shortly." }, 429);
          if (status === 402)
            return json({ error: "AI credits exhausted. Please add credits." }, 402);
          console.error("[/api/interview]", message);
          return json({ error: message }, status);
        }
      },
    },
  },
});
