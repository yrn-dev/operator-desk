export const DEFAULT_THINKING_LEVEL = "high";
// Shared by initial sessions, runtime rebuilds and prompt construction.
export const DEFAULT_ACTIVE_TOOL_NAMES = Object.freeze([
    "read", "read_full", "grep", "find", "ls", "bash", "edit", "patch", "write",
    "web_search", "app_control", "task_plan", "task_update", "task_list",
    "memory_store", "memory_recall", "test_run", "git_status", "git_diff", "git_commit",
]);
