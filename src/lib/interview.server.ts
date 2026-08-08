import {
  buildFocusAreas,
  buildSystemPrompt,
  getCandidate,
  interviewSchema,
  MAX_QUESTIONS,
  type Candidate,
} from "@/lib/interview-core";

type Turn = { role: "user" | "assistant"; text: string };

type Session = {
  candidate: Candidate;
  system: string;
  turns: Turn[];
  questions: number;
  days: Set<number>;
  updatedAt: number;
};

const sessions = new Map<string, Session>();
const SESSION_TTL = 1000 * 60 * 60 * 2;

function gc() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.updatedAt > SESSION_TTL) sessions.delete(id);
}

export type InterviewResult = {
  reply: string;
  done: boolean;
  feedback?: {
    summary: string;
    strengths: string[];
    gaps: string[];
    next: string[];
  };
};

type ModelOut = {
  reply: string;
  done: boolean;
  questionAsked: boolean;
  dayCovered: number | null;
  feedback: { summary: string; strengths: string[]; gaps: string[]; next: string[] } | null;
};

async function callModel(session: Session, directive: string): Promise<ModelOut> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

  const input = [
    { role: "system", content: [{ type: "input_text", text: session.system }] },
    ...session.turns.map((t) =>
      t.role === "user"
        ? { role: "user", content: [{ type: "input_text", text: t.text }] }
        : { role: "assistant", content: [{ type: "output_text", text: t.text }] },
    ),
    { role: "system", content: [{ type: "input_text", text: directive }] },
  ];

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.6-sol",
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      text: {
        format: {
          type: "json_schema",
          name: "interview_turn",
          strict: true,
          schema: interviewSchema,
        },
      },
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    const err = new Error(detail || `Gateway error ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  // Read the SSE stream and accumulate the final text.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: { output_text?: string };
        };
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          text += evt.delta;
        } else if (evt.type === "response.completed" && evt.response?.output_text) {
          if (!text) text = evt.response.output_text;
        }
      } catch {
        /* ignore keepalive / partial frames */
      }
    }
  }

  const parsed = JSON.parse(text) as ModelOut;
  return parsed;
}

export async function startInterview(
  sessionId: string,
  candidateInput: Candidate | { id?: string } | undefined,
): Promise<InterviewResult> {
  gc();
  let candidate: Candidate | undefined;
  if (candidateInput && "member" in candidateInput) {
    candidate = candidateInput as Candidate;
  } else if (candidateInput && typeof candidateInput.id === "string") {
    candidate = getCandidate(candidateInput.id);
  }
  if (!candidate) throw new Error("A valid candidate object (or { id }) is required to start.");

  const focus = buildFocusAreas(candidate);
  const session: Session = {
    candidate,
    system: buildSystemPrompt(candidate, focus),
    turns: [],
    questions: 0,
    days: new Set<number>(),
    updatedAt: Date.now(),
  };
  sessions.set(sessionId, session);

  const out = await callModel(
    session,
    "Open the interview: greet the candidate by first name, set expectations in one sentence (roughly 8-10 questions, conversational, based on their cohort work), then ask your first question. done=false.",
  );
  return commit(session, out);
}

export async function continueInterview(
  sessionId: string,
  message: string,
): Promise<InterviewResult> {
  gc();
  const session = sessions.get(sessionId);
  if (!session) {
    const e = new Error("Unknown sessionId. Start the interview first.") as Error & {
      status?: number;
    };
    e.status = 404;
    throw e;
  }
  session.turns.push({ role: "user", text: message });

  const remaining = Math.max(0, 8 - session.questions);
  const coverage = [...session.days].join(", ") || "none yet";
  const directive =
    session.questions >= MAX_QUESTIONS
      ? "You have reached the question limit. Close the interview now: set done=true and provide the full feedback object."
      : `Progress: ${session.questions} question(s) asked so far, covering curriculum days [${coverage}]. ${
          remaining > 0
            ? `You must ask at least ${remaining} more question(s) and cover at least 4 different curriculum days before ending, so done=false.`
            : "Minimum coverage reached: you may either ask one more sharp question or close the interview with done=true and full feedback."
        } Respond to what the candidate just said before your next question.`;

  const out = await callModel(session, directive);
  return commit(session, out);
}

function commit(session: Session, out: ModelOut): InterviewResult {
  session.turns.push({ role: "assistant", text: out.reply });
  if (out.questionAsked) session.questions += 1;
  if (typeof out.dayCovered === "number") session.days.add(out.dayCovered);
  session.updatedAt = Date.now();

  const result: InterviewResult = { reply: out.reply, done: out.done };
  if (out.done && out.feedback) result.feedback = out.feedback;
  return result;
}
