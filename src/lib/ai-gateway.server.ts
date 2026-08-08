/**
 * Thin wrapper around the Vercel AI Gateway via the AI SDK.
 * Returns parsed structured JSON validated against the provided JSON schema.
 *
 * The Item/Part shapes are kept from the original Lovable gateway wrapper so
 * callers (interview, portfolio, vision) work unchanged.
 */
import { generateText, jsonSchema, Output, type ModelMessage } from "ai";

export type Part =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | { type: "input_image"; image_url: string };

export type Item = { role: "system" | "user" | "assistant"; content: Part[] };

export const MODEL = "openai/gpt-5.6-sol";

function textOf(item: Item): string {
  return item.content
    .map((p) => ("text" in p ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * The AI SDK requires system content in `instructions` rather than as system
 * messages. Callers interleave system directives with the conversation, so we
 * merge every system item (in order) into one instructions string.
 */
function toPrompt(items: Item[]): { instructions: string; messages: ModelMessage[] } {
  const instructions = items
    .filter((i) => i.role === "system")
    .map(textOf)
    .filter(Boolean)
    .join("\n\n");

  const messages = items
    .filter((i) => i.role !== "system")
    .map((item): ModelMessage => {
      if (item.role === "assistant") {
        return { role: "assistant", content: textOf(item) };
      }
      return {
        role: "user",
        content: item.content.map((p) =>
          p.type === "input_image"
            ? ({ type: "image", image: p.image_url } as const)
            : ({ type: "text", text: p.text } as const),
        ),
      };
    });

  // generateText requires at least one message; on interview start the
  // conversation is empty because everything lives in the instructions.
  if (!messages.length) {
    messages.push({
      role: "user",
      content: [{ type: "text", text: "Begin now, following your instructions." }],
    });
  }

  return { instructions, messages };
}

export async function callStructured<T>(opts: {
  items: Item[];
  schema: unknown;
  schemaName: string;
  effort?: "low" | "medium";
}): Promise<T> {
  const { instructions, messages } = toPrompt(opts.items);
  const { output } = await generateText({
    model: MODEL,
    instructions,
    messages,
    output: Output.object({
      schema: jsonSchema<T>(opts.schema as Parameters<typeof jsonSchema>[0]),
    }),
    providerOptions: {
      openai: { reasoningEffort: opts.effort ?? "low" },
    },
  });

  if (output == null) throw new Error("The model returned an empty response.");
  return output as T;
}
