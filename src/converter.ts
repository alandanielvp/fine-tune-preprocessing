/**
 * Types for OpenAI fine-tuning message format.
 */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  weight?: number;
}

export interface Sample {
  messages: Message[];
}

type Role = "assistant" | "user";

interface ParsedLine {
  sender: string;
  content: string;
}

/**
 * Converts WhatsApp chat export text(s) into OpenAI fine-tuning format.
 *
 * @param chats - One or more WhatsApp chat export strings
 * @param firstRole - Role of the first person who speaks
 * @param systemPrompt - Optional system prompt to prepend
 * @returns Array of fine-tuning samples
 */
export function convertChats(
  chats: string | string[],
  firstRole: Role,
  systemPrompt?: string,
): Sample[] {
  const texts = Array.isArray(chats) ? chats : [chats];
  return texts.flatMap((text) =>
    convertSingleChat(text, firstRole, systemPrompt),
  );
}

function convertSingleChat(
  text: string,
  firstRole: Role,
  systemPrompt?: string,
): Sample[] {
  // Parse lines into { sender, content } objects
  const LINE_RE =
    /^(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.\s*m\.|p\.\s*m\.|[AaPp]\.?\s*[Mm]\.?)?\s*-\s+/;
  const SKIP = [
    /<multimedia omitido>/i,
    /<media omitted>/i,
    /se eliminó este mensaje/i,
    /this message was deleted/i,
  ];

  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  const parsed: ParsedLine[] = [];
  let current: ParsedLine | null = null;

  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (m) {
      if (current) parsed.push(current);
      const rest = line.slice(m[0].length);
      const colonIdx = rest.indexOf(": ");
      if (colonIdx === -1) {
        current = null;
        continue;
      } // WA system msg (no sender), skip
      current = {
        sender: rest.slice(0, colonIdx).trim(),
        content: rest.slice(colonIdx + 2).trim(),
      };
    } else if (current) {
      current.content += "\n" + line; // multi-line message continuation
    }
  }
  if (current) parsed.push(current);

  // Filter out media placeholders and deleted messages
  const msgs = parsed.filter(
    (m) => !SKIP.some((p) => p.test(m.content.trim())),
  );
  if (msgs.length === 0) return [];

  // Assign roles: first sender gets `firstRole`, everyone else gets the other
  const otherRole: Role = firstRole === "assistant" ? "user" : "assistant";
  const firstSender = msgs[0].sender;
  const withRoles = msgs.map((m) => ({
    role: (m.sender === firstSender ? firstRole : otherRole) as Role,
    content: m.content.trim(),
  }));

  // Merge consecutive same-role messages with \n
  const merged = [{ ...withRoles[0] }];
  for (let i = 1; i < withRoles.length; i++) {
    const prev = merged[merged.length - 1];
    if (withRoles[i].role === prev.role) {
      prev.content += "\n" + withRoles[i].content;
    } else {
      merged.push({ ...withRoles[i] });
    }
  }

  // Need at least one assistant and one user message
  if (
    !merged.some((m) => m.role === "assistant") ||
    !merged.some((m) => m.role === "user")
  ) {
    return [];
  }

  // Build output: system prompt + messages with weight on assistant turns
  const messages: Message[] = [];
  if (systemPrompt)
    messages.push({ role: "system", content: systemPrompt, weight: 0 });
  for (const m of merged) {
    const entry: Message = {
      role: m.role,
      content: m.content,
      weight: m.role === "assistant" ? 1 : 0,
    };
    messages.push(entry);
  }

  return [{ messages }];
}
