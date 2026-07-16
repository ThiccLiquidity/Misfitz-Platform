// $CHIPS payout bot — human confirmation GATE (terminal). The orchestrator shows the operator a dry-run summary
// and only proceeds if this returns true. Requires the operator to type the exact word "SEND" — no bare "y", so
// an accidental keypress can't broadcast real payments.
import { createInterface } from "node:readline";

export class TerminalConfirmGate {
  async confirm(summary: string): Promise<boolean> {
    process.stdout.write("\n" + summary + "\n\n");
    process.stdout.write('Type SEND to broadcast these payments, anything else to abort: ');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer: string = await new Promise((res) => rl.question("", res));
    rl.close();
    return answer.trim() === "SEND";
  }
}

// Dry-run gate: never confirms. Used by `preview` so the exact same code path shows the plan and sends nothing.
export class NeverConfirmGate {
  async confirm(_summary: string): Promise<boolean> { void _summary; return false; }
}
