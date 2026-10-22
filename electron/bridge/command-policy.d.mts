export const COMMAND_TOOLS: Set<string>;
export function subjectOf(tool: string, input: Record<string, unknown>): string;
export type PolicyRule = { tool?: string; subject?: string; pattern?: string; action: "allow" | "ask" | "deny" };
export function matchRule(rules: unknown, tool: string, subject: string): PolicyRule | null;
export function rememberedRule(tool: string, subject: string): { tool: string; subject: string; action: "allow" };
export function isDangerousCommand(command: string): boolean;
