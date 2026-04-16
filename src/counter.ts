import { encode } from "gpt-tokenizer";

/**
 * Per-message overhead in OpenAI fine-tuning format.
 * Each message adds ~4 tokens: <|im_start|>, role, \n, <|im_end|>\n
 * Each conversation adds ~2 tokens for the priming assistant reply.
 */
const TOKENS_PER_MESSAGE = 4;
const TOKENS_PER_CONVERSATION = 2;

export interface TokenStats {
  /** Total tokens across all conversations */
  totalTokens: number;
  /** Token count per conversation (per JSONL line) */
  perLine: number[];
}

/**
 * Count the tokens in a set of JSONL lines (fine-tuning conversations).
 * Accounts for per-message and per-conversation overhead.
 */
export function countTokens(jsonlLines: string[]): TokenStats {
  const perLine: number[] = [];
  let totalTokens = 0;

  for (const line of jsonlLines) {
    let lineTokens = 0;
    try {
      const obj = JSON.parse(line);
      const messages: { role: string; content: string }[] = obj.messages ?? [];
      for (const msg of messages) {
        lineTokens += TOKENS_PER_MESSAGE;
        lineTokens += encode(msg.role).length;
        lineTokens += encode(msg.content).length;
      }
      lineTokens += TOKENS_PER_CONVERSATION;
    } catch {
      // If a line isn't valid JSON, count raw characters as fallback
      lineTokens = encode(line).length;
    }
    perLine.push(lineTokens);
    totalTokens += lineTokens;
  }

  return { totalTokens, perLine };
}

/**
 * Estimate fine-tuning cost.
 *
 * @param totalTokens - Total tokens in the training file
 * @param epochs - Number of training epochs (default 3)
 * @param pricePerMillionTokens - Cost per 1 M training tokens
 * @returns Estimated cost in dollars
 */
export function estimateCost(
  totalTokens: number,
  epochs: number,
  pricePerMillionTokens: number,
): number {
  return (totalTokens * epochs * pricePerMillionTokens) / 1_000_000;
}
