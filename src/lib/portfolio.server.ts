import { callStructured, type Item } from "@/lib/ai-gateway.server";
import type { Candidate, Dossier } from "@/lib/interview-core";

const GH = "https://api.github.com";
const UA = { "User-Agent": "ada-interview-agent", Accept: "application/vnd.github+json" };

export function parseHandle(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const m = raw.match(/github\.com\/([^/?#]+)/i);
  const handle = (m?.[1] ?? raw).replace(/^@/, "").trim();
  return /^[A-Za-z0-9-]{1,39}$/.test(handle) ? handle : null;
}

type Repo = {
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  topics?: string[];
  pushed_at: string;
  default_branch: string;
  languages_url: string;
};

async function ghJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function readme(handle: string, repo: Repo): Promise<string> {
  for (const branch of [repo.default_branch, "main", "master"]) {
    for (const file of ["README.md", "readme.md"]) {
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${handle}/${repo.name}/${branch}/${file}`,
        );
        if (res.ok) return (await res.text()).slice(0, 2500);
      } catch {
        /* try next */
      }
    }
  }
  return "";
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

async function fetchProfileUrl(url: string): Promise<{ text: string; note: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ada-interview-agent)" },
    });
    if (!res.ok) {
      return {
        text: "",
        note: `${new URL(url).hostname} returned ${res.status} (public scraping blocked).`,
      };
    }
    const text = stripHtml(await res.text());
    if (text.length < 200) {
      return { text: "", note: `${new URL(url).hostname} served no readable public content.` };
    }
    return { text, note: "" };
  } catch {
    return { text: "", note: `Could not reach ${url}.` };
  }
}

const dossierSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    profile: { type: "string", description: "2-3 sentence read on what this person actually builds." },
    stack: { type: "array", items: { type: "string" } },
    projects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          url: { type: "string" },
          summary: { type: "string" },
          stack: { type: "array", items: { type: "string" } },
          probe: {
            type: "string",
            description:
              "One specific interview question about a real technical decision visible in this project.",
          },
        },
        required: ["name", "url", "summary", "stack", "probe"],
      },
    },
    probes: {
      type: "array",
      items: { type: "string" },
      description: "Cross-cutting contextual questions tying their real work to cohort topics.",
    },
  },
  required: ["profile", "stack", "projects", "probes"],
} as const;

type DossierModelOut = Pick<Dossier, "profile" | "stack" | "projects" | "probes">;

export async function buildDossier(
  candidate: Candidate,
  input: { github?: string; url?: string },
): Promise<Dossier> {
  const handle = input.github ? parseHandle(input.github) : null;
  const sources: string[] = [];
  const notes: string[] = [];

  let evidence = "";

  if (input.github && !handle) notes.push(`"${input.github}" is not a valid GitHub handle or URL.`);

  if (handle) {
    const user = await ghJson<{
      login: string;
      name: string | null;
      bio: string | null;
      company: string | null;
      blog: string | null;
      location: string | null;
      public_repos: number;
      followers: number;
    }>(`${GH}/users/${handle}`);

    if (!user) {
      notes.push(`GitHub user "${handle}" not found or the API rate limit was hit.`);
    } else {
      sources.push(`https://github.com/${handle}`);
      const repos = (await ghJson<Repo[]>(`${GH}/users/${handle}/repos?per_page=100&sort=pushed`)) ?? [];
      const picked = repos
        .filter((r) => !r.fork)
        .sort(
          (a, b) =>
            b.stargazers_count - a.stargazers_count ||
            Date.parse(b.pushed_at) - Date.parse(a.pushed_at),
        )
        .slice(0, 6);

      const details = await Promise.all(
        picked.map(async (r) => {
          const langs = (await ghJson<Record<string, number>>(r.languages_url)) ?? {};
          const rm = await readme(handle, r);
          return (
            `### ${r.name} (${r.html_url})\n` +
            `stars: ${r.stargazers_count} | last push: ${r.pushed_at.slice(0, 10)}\n` +
            `description: ${r.description ?? "none"}\n` +
            `topics: ${(r.topics ?? []).join(", ") || "none"}\n` +
            `languages: ${Object.keys(langs).join(", ") || r.language || "unknown"}\n` +
            (rm ? `README excerpt:\n${rm}\n` : "")
          );
        }),
      );

      evidence +=
        `GITHUB PROFILE @${user.login}\n` +
        `name: ${user.name ?? "n/a"} | bio: ${user.bio ?? "n/a"} | company: ${user.company ?? "n/a"}\n` +
        `location: ${user.location ?? "n/a"} | public repos: ${user.public_repos} | followers: ${user.followers}\n\n` +
        `TOP REPOSITORIES\n${details.join("\n")}\n`;
      if (!picked.length) notes.push("No original (non-fork) public repositories found.");
    }
  }

  if (input.url?.trim()) {
    const url = input.url.trim();
    const { text, note } = await fetchProfileUrl(url);
    if (text) {
      sources.push(url);
      evidence += `\nPROFILE / PORTFOLIO PAGE (${url})\n${text}\n`;
    }
    if (note) notes.push(note);
  }

  if (!evidence) {
    return {
      handle,
      profile: "",
      stack: [],
      projects: [],
      probes: [],
      sources,
      notes: notes.length ? notes : ["No public profile data was found to analyse."],
    };
  }

  const items: Item[] = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You are a staff engineer preparing to interview a candidate. You are given raw scraped public evidence of their real work. " +
            "Extract only what the evidence supports — never invent projects, stacks, or decisions. " +
            "For each notable project, write ONE probing question about a concrete technical decision you can actually see " +
            '(e.g. "I noticed you used React Context in project X rather than a store like Zustand — what pushed you that way as state grew?"). ' +
            "Questions must be specific, generous in tone, and answerable only by someone who really built it. " +
            "Prefer at most 4 projects. Return the required JSON.",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            `Candidate: ${candidate.member.name}, target role ${candidate.member.jobRole}, ` +
            `${candidate.member.yearsExperience} years experience.\n` +
            `Cohort topics they studied: ${candidate.missions.map((m) => `Day ${m.day} ${m.title}`).join("; ")}\n\n` +
            `PUBLIC EVIDENCE\n${evidence.slice(0, 40000)}`,
        },
      ],
    },
  ];

  const out = await callStructured<DossierModelOut>({
    items,
    schema: dossierSchema,
    schemaName: "portfolio_dossier",
    effort: "low",
  });

  return { handle, ...out, sources, notes };
}
