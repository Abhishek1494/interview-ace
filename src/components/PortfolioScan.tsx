import { useState } from "react";
import { Github, Link2, Loader2, Search, Sparkles } from "lucide-react";

import type { Candidate, Dossier } from "@/lib/interview-core";
import { Button } from "@/components/ui/button";

type Props = {
  candidate: Candidate;
  dossier: Dossier | null;
  onDossier: (d: Dossier) => void;
  onStart: () => void;
  onBack: () => void;
};

/** Pre-interview "Portfolio Detective" scan of the candidate's real public work. */
export function PortfolioScan({ candidate, dossier, onDossier, onStart, onBack }: Props) {
  const [github, setGithub] = useState("");
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    if (!github.trim() && !url.trim()) {
      setError("Add a GitHub handle or a profile URL first.");
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.member.id, github, url }),
      });
      const data = (await res.json()) as { dossier?: Dossier; error?: string };
      if (!res.ok || !data.dossier) throw new Error(data.error ?? "Scan failed.");
      onDossier(data.dossier);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-4 rounded-xl border border-border bg-card/70 p-5 backdrop-blur">
        <div>
          <h2 className="font-display text-lg">Portfolio detective</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Before interviewing {candidate.member.name.split(" ")[0]}, Ada reads their real public
            work and turns concrete technical decisions into questions. Optional — you can skip
            straight to the cohort-based interview.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Github className="size-3.5" /> GitHub handle or URL
          </span>
          <input
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            placeholder="e.g. torvalds"
            className="w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Link2 className="size-3.5" /> LinkedIn or portfolio URL
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex flex-col gap-2">
          <Button onClick={() => void scan()} disabled={scanning} className="gap-2">
            {scanning ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {scanning ? "Reading their work…" : dossier ? "Re-scan" : "Scan public work"}
          </Button>
          <Button variant="secondary" onClick={onStart} className="gap-2">
            <Sparkles className="size-4" />
            {dossier?.projects.length ? "Start interview with dossier" : "Skip and start interview"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            Choose a different candidate
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur">
        {!dossier && !scanning && (
          <p className="text-sm text-muted-foreground">
            No dossier yet. Ada will pull their profile, top non-fork repositories, languages and
            READMEs, then draft questions about decisions she can actually see in the code.
          </p>
        )}
        {scanning && (
          <p className="animate-pulse font-display text-xs uppercase tracking-widest text-primary">
            Reading repositories…
          </p>
        )}
        {dossier && <DossierView dossier={dossier} />}
      </div>
    </section>
  );
}

export function DossierView({ dossier, compact = false }: { dossier: Dossier; compact?: boolean }) {
  return (
    <div className="space-y-4">
      {dossier.profile && (
        <p className="text-sm leading-relaxed text-muted-foreground">{dossier.profile}</p>
      )}
      {dossier.stack.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dossier.stack.map((s) => (
            <span
              key={s}
              className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {dossier.projects.map((p) => (
        <div key={p.url + p.name} className="rounded-lg border border-border/70 bg-background/40 p-3">
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-medium hover:text-primary"
          >
            {p.name}
          </a>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.summary}</p>
          {!compact && p.stack.length > 0 && (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {p.stack.join(" · ")}
            </p>
          )}
          <p className="mt-2 border-l-2 border-primary/50 pl-2 text-xs italic leading-relaxed">
            “{p.probe}”
          </p>
        </div>
      ))}

      {!compact && dossier.probes.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Cross-cutting probes
          </h3>
          <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            {dossier.probes.map((p, i) => (
              <li key={i}>• {p}</li>
            ))}
          </ul>
        </div>
      )}

      {dossier.notes.length > 0 && (
        <p className="text-[11px] leading-relaxed text-signal-skipped">
          {dossier.notes.join(" ")}
        </p>
      )}
      {dossier.sources.length > 0 && (
        <p className="text-[10px] text-muted-foreground">Sources: {dossier.sources.join(" · ")}</p>
      )}
    </div>
  );
}
