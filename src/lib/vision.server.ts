import { callStructured, type Item, type Part } from "@/lib/ai-gateway.server";
import type { PresenceReading } from "@/lib/interview-core";

const presenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    confidence: {
      type: "integer",
      description: "0-100 read of how confident and composed they look right now.",
    },
    posture: { type: "string", description: "Few words, e.g. 'upright, leaning in'." },
    eyeContact: { type: "string", description: "Few words, e.g. 'steady on camera'." },
    gestures: { type: "string", description: "Few words, e.g. 'uses hands to explain'." },
    energy: { type: "string", description: "Few words, e.g. 'calm and engaged'." },
    note: {
      type: "string",
      description: "One coaching sentence addressed to the candidate, warm and specific.",
    },
  },
  required: ["confidence", "posture", "eyeContact", "gestures", "energy", "note"],
} as const;

/**
 * Reads 1-3 webcam stills captured while the candidate was answering and returns a
 * body-language snapshot. Deliberately non-judgemental: it coaches communication style,
 * it never scores appearance or identity.
 */
export async function analyzePresence(
  frames: string[],
  context: { topic: string; answer: string },
): Promise<PresenceReading> {
  const usable = frames.filter((f) => f.startsWith("data:image/")).slice(0, 3);
  if (!usable.length) throw new Error("No camera frames provided.");

  const content: Part[] = [
    {
      type: "input_text",
      text:
        "These are webcam stills of a candidate during a technical interview, captured a few seconds apart.\n" +
        `They were answering a question about: ${context.topic || "the interview"}.\n` +
        (context.answer ? `Their answer began: "${context.answer.slice(0, 300)}"\n` : "") +
        "\nDescribe ONLY communication signals: posture, orientation to camera, hand gestures, fidgeting, " +
        "facial engagement and overall composure. Never comment on appearance, attractiveness, clothing, " +
        "ethnicity, gender, age, health, or the room. If the frames are too dark or the person is out of " +
        "frame, say so plainly in `note` and give confidence 50. Be encouraging and concrete, like a career coach.",
    },
    ...usable.map((url) => ({ type: "input_image", image_url: url }) as Part),
  ];

  const items: Item[] = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You are a communication coach observing an interview. You output short, kind, actionable " +
            "reads of delivery and body language only. Return the required JSON.",
        },
      ],
    },
    { role: "user", content },
  ];

  return callStructured<PresenceReading>({
    items,
    schema: presenceSchema,
    schemaName: "presence_reading",
    effort: "low",
  });
}
