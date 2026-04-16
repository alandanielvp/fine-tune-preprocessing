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

export interface ConvertOptions {
  firstRole: Role;
  systemPrompt?: string;
  filterEmojis?: boolean;
}

// Broad emoji regex covering most emoji ranges
const EMOJI_RE =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\u{FE0F}]/gu;

function stripEmojis(text: string): string {
  return text.replace(EMOJI_RE, "").replace(/ {2,}/g, " ").trim();
}

/**
 * Converts WhatsApp chat export text(s) into OpenAI fine-tuning format.
 *
 * @param chats - One or more WhatsApp chat export strings
 * @param options - Conversion options
 * @returns Array of fine-tuning samples
 */
export function convertChats(
  chats: string | string[],
  options: ConvertOptions,
): Sample[] {
  const texts = Array.isArray(chats) ? chats : [chats];
  return texts.flatMap((text) => convertSingleChat(text, options));
}

function convertSingleChat(text: string, options: ConvertOptions): Sample[] {
  const { firstRole, systemPrompt, filterEmojis = true } = options;
  // Parse lines into { sender, content } objects
  // Supports two WhatsApp export formats:
  //   Format A (dash):    "14/04/26, 12:35 p.m. - Sender: msg"
  //   Format B (bracket): "[14/04/26, 12:35:05 p.m.] Sender: msg"
  const LINE_RE =
    /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.\s*m\.|p\.\s*m\.|[AaPp]\.?\s*[Mm]\.?)?\s*(?:\]\s+|-\s+)/;
  const SKIP = [
    /<multimedia omitido>/i,
    /<media omitted>/i,
    /se eliminó este mensaje/i,
    /this message was deleted/i,
    /los mensajes y las llamadas están cifrados de extremo a extremo/i,
    /messages and calls are end-to-end encrypted/i,
  ];

  // Strip BOM and zero-width / left-to-right mark characters
  const clean = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(
    /[\u200E\u200F\u200B\u200C\u200D\uFEFF]/g,
    "",
  );
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
        sender: rest.slice(0, colonIdx).trim().replace(/^~/, ""),
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
    content: filterEmojis ? stripEmojis(m.content.trim()) : m.content.trim(),
  }));

  // Need at least one assistant and one user message
  if (
    !withRoles.some((m) => m.role === "assistant") ||
    !withRoles.some((m) => m.role === "user")
  ) {
    return [];
  }

  // Build output: system prompt + messages with weight on assistant turns
  const messages: Message[] = [];
  if (systemPrompt)
    messages.push({ role: "system", content: systemPrompt, weight: 0 });
  for (const m of withRoles) {
    const entry: Message = {
      role: m.role,
      content: m.content,
      weight: m.role === "assistant" ? 1 : 0,
    };
    messages.push(entry);
  }

  return [{ messages }];
}
