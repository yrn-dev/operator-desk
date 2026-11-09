/**
 * System prompt construction and project context loading
 */
import { type Skill } from "./skills.ts";
export interface BuildSystemPromptOptions {
    /** Custom system prompt (replaces default). */
    customPrompt?: string;
    /** Active tools to include in prompt; defaults to DEFAULT_ACTIVE_TOOL_NAMES. Empty means no tools. */
    selectedTools?: string[];
    /** Optional one-line tool snippets keyed by tool name. */
    toolSnippets?: Record<string, string>;
    /** Additional guideline bullets included with either default or custom base prompts. */
    promptGuidelines?: string[];
    /** Text to append to system prompt. */
    appendSystemPrompt?: string;
    /** Working directory. */
    cwd: string;
    /** Pre-loaded context files. */
    contextFiles?: Array<{
        path: string;
        content: string;
    }>;
    /** Pre-loaded skills. */
    skills?: Skill[];
}
/** Build the system prompt with tools, guidelines, and context */
export declare function buildSystemPrompt(options: BuildSystemPromptOptions): string;
//# sourceMappingURL=system-prompt.d.ts.map
