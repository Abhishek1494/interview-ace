import {
  buildDossierPrompt,
  buildFocusAreas,
  buildPresencePrompt,
  buildStressPrompt,
  buildSystemPrompt,
  getCandidate,
  interviewSchema,
  MAX_QUESTIONS,
  type Candidate,
  type Dossier,
  type PresenceReading,
} from "@/lib/interview-core";
import { callStructured, type Item } from "@/lib/ai-gateway.server";

type Turn = { role: "user" | "assistant"; text: string };

type Session = {
  candidate: Candidate;
  system: string;
  turns: Turn[];
  questions: number;
  days: Set<number>;
  dossier: Dossier | null;
  presence: PresenceReading[];
  stress: boolean;
  turnsSinceEvent: number;
  updatedAt: number;
};

const sessions = new Map<string, Session>();
const SESSION_TTL = 1000 * 60 * 60 * 2;

function gc() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.updatedAt > SESSION_TTL) sessions.delete(id);
}

export type Feedback = {
  summary: string;
  strengths: string[];
  gaps: string[];
  next: string[];
  communication: string[];
};

export type InterviewResult = {
  reply: string;
  done: boolean;
  pressureEvent?: string;
  pressureLabel?: string;
  secondsForNextAnswer?: number;
  feedback?: Feedback;
};

type ModelOut = {
  reply: string;
  done: boolean;
  questionAsked: boolean;
  dayCovered: number | null;
  pressureEvent: string | null;
  pressureLabel: string | null;
  secondsForNextAnswer: number | null;
  feedback: Feedback | null;
};

/** Attach a camera-derived delivery reading to a live session. */
export function recordPresence(sessionId: string, reading: PresenceReading): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.presence.push(reading);
  if (session.presence.length > 20) session.presence.shift();
  session.updatedAt = Date.now();
  return true;
}

/** The last thing Ada asked — used as context for the camera read. */
export function lastQuestion(sessionId: string): string {
  const session = sessions.get(sessionId);
  if (!session) return "";
  const last = [...session.turns].reverse().find((t) => t.role === "assistant");
  return last?.text ?? "";
}


async function callModel(session: Session, directive: string): Promise<ModelOut> {
  const items: Item[] = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            session.system +
            buildDossierPrompt(session.dossier) +
            buildPresencePrompt(session.presence) +
            buildStressPrompt(session.stress),
        },
      ],
    },
    ...session.turns.map<Item>((t) =>
      t.role === "user"
        ? { role: "user", content: [{ type: "input_text", text: t.text }] }
        : { role: "assistant", content: [{ type: "output_text", text: t.text }] },
    ),
    { role: "system", content: [{ type: "input_text", text: directive }] },
  ];

  return callStructured<ModelOut>({
    items,
    schema: interviewSchema,
    schemaName: "interview_turn",
    effort: "low",
  });
}

export async function startInterview(
  sessionId: string,
  candidateInput: Candidate | { id?: string } | undefined,
  dossier?: Dossier | null,
  stress = false,
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
    dossier: dossier ?? null,
    presence: [],
    stress,
    turnsSinceEvent: 0,
    updatedAt: Date.now(),
  };
  sessions.set(sessionId, session);

  const hasDossier = !!dossier?.projects.length;
  const out = await callModel(
    session,
    "Open the interview: greet the candidate by first name, set expectations in one sentence (roughly 8-10 questions, conversational, based on their cohort work" +
      (hasDossier ? " and the public projects you looked at" : "") +
      ")," +
      (stress
        ? " warn them in one short line that this is a stress-test interview with interruptions, ambiguous briefs and timed answers,"
        : "") +
      " then ask your first question. done=false.",
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

  const stressDirective =
    session.stress && session.questions < MAX_QUESTIONS
      ? session.turnsSinceEvent >= 2
        ? " STRESS: it has been a while since the last curveball — this turn MUST apply a pressure event (interruption, multitask or ambiguous brief) and set pressureEvent/pressureLabel accordingly."
        : " STRESS: keep the pressure realistic; add a timed window with secondsForNextAnswer when it fits."
      : "";

  const out = await callModel(session, directive + stressDirective);
  return commit(session, out);
}

function commit(session: Session, out: ModelOut): InterviewResult {
  session.turns.push({ role: "assistant", text: out.reply });
  if (out.questionAsked) session.questions += 1;
  if (typeof out.dayCovered === "number") session.days.add(out.dayCovered);
  session.updatedAt = Date.now();

  if (out.pressureEvent) session.turnsSinceEvent = 0;
  else session.turnsSinceEvent += 1;

  const result: InterviewResult = { reply: out.reply, done: out.done };
  if (session.stress && out.pressureEvent) {
    result.pressureEvent = out.pressureEvent;
    if (out.pressureLabel) result.pressureLabel = out.pressureLabel;
  }
  if (session.stress && typeof out.secondsForNextAnswer === "number" && !out.done)
    result.secondsForNextAnswer = out.secondsForNextAnswer;
  if (out.done && out.feedback) result.feedback = out.feedback;
  return result;
}
