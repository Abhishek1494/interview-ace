import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUp,
  CircleCheck,
  CircleSlash,
  Flame,
  MessageSquare,
  RotateCcw,
  Square,
} from "lucide-react";

import { candidates, buildFocusAreas, type Candidate, type Dossier } from "@/lib/interview-core";
import { CameraCoach } from "@/components/CameraCoach";
import { DossierView, PortfolioScan } from "@/components/PortfolioScan";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ada · AI Interview Agent for the AI Cohort" },
      {
        name: "description",
        content:
          "Ada runs adaptive, multi-turn technical interviews built from each candidate's 31-day AI Cohort missions, then returns structured feedback.",
      },
      { property: "og:title", content: "Ada · AI Interview Agent" },
      {
        property: "og:description",
        content:
          "Adaptive technical interviews grounded in the candidate's own cohort missions, attempts and skipped topics.",
      },
    ],
  }),
  component: InterviewPage,
});

type Feedback = {
  summary: string;
  strengths: string[];
  gaps: string[];
  next: string[];
  communication?: string[];
};
type Msg = { role: "agent" | "candidate"; text: string };

const signalStyle: Record<string, string> = {
  strong: "text-signal-strong border-signal-strong/40 bg-signal-strong/10",
  struggled: "text-signal-struggled border-signal-struggled/40 bg-signal-struggled/10",
  skipped: "text-signal-skipped border-signal-skipped/40 bg-signal-skipped/10",
};

function InterviewPage() {
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [stage, setStage] = useState<"select" | "setup" | "live">("select");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const focus = useMemo(() => (selected ? buildFocusAreas(selected) : []), [selected]);
  const started = messages.length > 0;
  const lastAnswer = useMemo(
    () => [...messages].reverse().find((m) => m.role === "candidate")?.text ?? "",
    [messages],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, feedback]);

  useEffect(() => {
    if (started && !busy && !feedback) inputRef.current?.focus();
  }, [started, busy, feedback]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        reply?: string;
        done?: boolean;
        feedback?: Feedback;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? "Something went wrong");
      if (data.reply) setMessages((m) => [...m, { role: "agent", text: data.reply as string }]);
      if (data.done && data.feedback) setFeedback(data.feedback);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function choose(candidate: Candidate) {
    setSelected(candidate);
    setDossier(null);
    setStage("setup");
  }

  async function start() {
    if (!selected) return;
    const id = crypto.randomUUID();
    setSessionId(id);
    setMessages([]);
    setFeedback(null);
    setStage("live");
    await post({ sessionId: id, candidate: selected, dossier });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || feedback) return;
    setInput("");
    setMessages((m) => [...m, { role: "candidate", text }]);
    await post({ sessionId, message: text });
  }

  function reset() {
    setSelected(null);
    setStage("select");
    setDossier(null);
    setMessages([]);
    setFeedback(null);
    setInput("");
    setSessionId("");
    setError(null);
  }


  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
            AI Cohort · 31 days · 8 modules
          </p>
          <h1 className="mt-2 text-4xl font-bold md:text-5xl">
            Ada, your <span className="text-primary">interview agent</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Ada reads a candidate&apos;s cohort record — missions passed, attempts burned, topics
            skipped — and runs an adaptive technical interview grounded in the exact curriculum days
            they lived through.
          </p>
        </div>
        {selected && (
          <Button variant="outline" onClick={reset} className="gap-2">
            <RotateCcw className="size-4" /> New session
          </Button>
        )}
      </header>

      {stage === "select" && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map((c) => (
            <button
              key={c.member.id}
              onClick={() => choose(c)}

              className="group rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{c.member.name}</h2>
                  <p className="text-xs text-muted-foreground">{c.member.jobRole}</p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {c.member.id}
                </Badge>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  ["Missions", c.signals.missionsCompleted],
                  ["1st try", c.signals.missionsFirstTry],
                  ["Active", `${c.signals.commitDays}d`],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-md bg-secondary/60 py-2">
                    <dd className="font-display text-lg leading-none">{value}</dd>
                    <dt className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {label}
                    </dt>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                {c.member.yearsExperience} yrs · {c.member.education}
              </p>
            </button>
          ))}
        </section>
      )}

      {selected && (
        <section className="grid flex-1 gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="flex min-h-[32rem] flex-col rounded-xl border border-border bg-card/70 backdrop-blur">
            <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto p-5">
              {messages.map((m, i) => (
                <div key={i} className={cn(m.role === "candidate" && "flex justify-end")}>
                  {m.role === "agent" ? (
                    <div className="max-w-[46rem]">
                      <p className="mb-1 font-display text-xs uppercase tracking-widest text-primary">
                        Ada
                      </p>
                      <p className="whitespace-pre-wrap leading-relaxed text-foreground">{m.text}</p>
                    </div>
                  ) : (
                    <p className="max-w-[38rem] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 leading-relaxed text-primary-foreground">
                      {m.text}
                    </p>
                  )}
                </div>
              ))}

              {busy && (
                <p className="animate-pulse font-display text-xs uppercase tracking-widest text-primary">
                  Ada is thinking…
                </p>
              )}

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                  {error}
                </p>
              )}

              {feedback && (
                <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
                  <h2 className="font-display text-lg">Interview feedback</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {feedback.summary}
                  </p>
                  {(
                    [
                      ["Strengths", feedback.strengths, CircleCheck, "text-signal-strong"],
                      ["Gaps", feedback.gaps, CircleSlash, "text-signal-skipped"],
                      ["Next steps", feedback.next, Flame, "text-primary"],
                    ] as const
                  ).map(([title, items, Icon, color]) => (
                    <div key={title}>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {title}
                      </h3>
                      <ul className="space-y-1.5">
                        {items.map((it, i) => (
                          <li key={i} className="flex gap-2 text-sm leading-relaxed">
                            <Icon className={cn("mt-0.5 size-4 shrink-0", color)} />
                            <span>{it}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border p-3">
              {feedback ? (
                <Button className="w-full gap-2" onClick={reset}>
                  <Square className="size-4" /> Interview complete — start another
                </Button>
              ) : (
                <div className="flex items-end gap-2 rounded-lg border border-input bg-background/60 p-2">
                  <textarea
                    ref={inputRef}
                    rows={2}
                    value={input}
                    disabled={busy}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="Answer out loud, then hit Enter…"
                    className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <Button
                    size="icon"
                    onClick={() => void send()}
                    disabled={busy || !input.trim()}
                    aria-label="Send answer"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4 rounded-xl border border-border bg-card/70 p-5 backdrop-blur">
            <div>
              <h2 className="font-display text-lg">{selected.member.name}</h2>
              <p className="text-xs text-muted-foreground">
                {selected.member.jobRole} · {selected.member.yearsExperience} yrs
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Interview focus
              </h3>
              <ul className="space-y-2">
                {focus.map((f) => (
                  <li key={f.day} className="rounded-lg border border-border/70 bg-background/40 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">Day {f.day}</span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                          signalStyle[f.signal],
                        )}
                      >
                        {f.signal}
                        {f.attempts ? ` · ${f.attempts}×` : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-snug">{f.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{f.module}</p>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </section>
      )}

      <footer className="pt-2 text-xs text-muted-foreground">
        API contract: <code className="text-foreground">POST /api/interview</code> ·{" "}
        {"{ sessionId, candidate }"} to start, {"{ sessionId, message }"} per turn, final turn
        returns {"{ done: true, feedback }"}.
      </footer>
    </main>
  );
}
