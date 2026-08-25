export function clientMediaFinalizationDecision(input: {
  total: number;
  delivered: number;
  unfinished: number;
}): "wait" | "confirm_delivered" | "close_failed" {
  for (const value of [input.total, input.delivered, input.unfinished]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Client media finalization counts are invalid.");
  }
  if (input.delivered > input.total || input.unfinished > input.total) {
    throw new Error("Client media finalization counts are inconsistent.");
  }
  if (input.total < 1 || input.unfinished > 0) return "wait";
  return input.delivered > 0 ? "confirm_delivered" : "close_failed";
}
