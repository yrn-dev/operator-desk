/**
 * Планы задач оператора приходят текстом вида
 *   Goal: …
 *   1. [x] Шаг (task-…)
 * — показываем их списком с отметками, а не сырым выводом.
 */
export type PlanStep = {
  text: string;
  done: boolean;
};

export type Plan = {
  goal: string | null;
  steps: PlanStep[];
};

const STEP = /^\s*\d+\.\s*\[([ xX~-])\]\s*(.+?)\s*$/;

export function parsePlan(output: string): Plan | null {
  if (!output.trim()) return null;

  const steps: PlanStep[] = [];
  let goal: string | null = null;

  for (const line of output.split("\n")) {
    const goalMatch = /^\s*(?:Goal|Цель)\s*:\s*(.+)$/.exec(line);
    if (goalMatch) {
      goal = goalMatch[1].trim();
      continue;
    }

    const step = STEP.exec(line);
    if (!step) continue;

    steps.push({
      // Идентификатор задачи в конце строки читателю не нужен.
      text: step[2].replace(/\s*\((?:task|todo)-[\w-]+\)\s*$/i, "").trim(),
      done: step[1].toLowerCase() === "x",
    });
  }

  return steps.length > 0 ? { goal, steps } : null;
}

export function PlanView({ plan }: { plan: Plan }) {
  const done = plan.steps.filter((step) => step.done).length;

  return (
    <div style={{ padding: "10px 12px 12px" }}>
      {plan.goal && (
        <div style={{ marginBottom: 10, fontSize: 13.5, color: "var(--text)" }}>{plan.goal}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {plan.steps.map((step, index) => (
          <div key={index} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 15,
                height: 15,
                flex: "none",
                marginTop: 1.5,
                borderRadius: 4,
                border: `1px solid ${step.done ? "var(--ok)" : "var(--line)"}`,
                background: step.done ? "rgba(85,217,143,.16)" : "transparent",
              }}
            >
              {step.done && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d="M1.6 5.2l2 2 4.8-5"
                    stroke="var(--ok)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span
              style={{
                fontSize: 13,
                lineHeight: 1.45,
                color: step.done ? "var(--text-faint)" : "var(--text)",
                textDecoration: step.done ? "line-through" : "none",
              }}
            >
              {step.text}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-faint)" }}>
        {done} из {plan.steps.length} выполнено
      </div>
    </div>
  );
}
