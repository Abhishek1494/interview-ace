import { createFileRoute } from "@tanstack/react-router";

import { getCandidate } from "@/lib/interview-core";
import { buildDossier } from "@/lib/portfolio.server";

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

export const Route = createFileRoute("/api/portfolio")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        let body: { candidateId?: string; github?: string; url?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Invalid JSON body." }, 400);
        }

        const candidate = body.candidateId ? getCandidate(body.candidateId) : undefined;
        if (!candidate) return json({ error: "Unknown candidateId." }, 400);
        if (!body.github?.trim() && !body.url?.trim()) {
          return json({ error: "Provide a GitHub handle or a profile URL." }, 400);
        }

        try {
          const dossier = await buildDossier(candidate, {
            github: body.github?.trim() ?? "",
            url: body.url?.trim() ?? "",
          });
          return json({ dossier });
        } catch (e) {
          const status = (e as { status?: number }).status ?? 500;
          return json(
            { error: e instanceof Error ? e.message : "Portfolio scan failed." },
            status === 429 || status === 402 ? status : 500,
          );
        }
      },
    },
  },
});
