export const TUTORIAL_STEP_IDS = [
  "welcome",
  "preparation",
  "order",
  "payment",
  "finish",
] as const;
export type TutorialStepId = (typeof TUTORIAL_STEP_IDS)[number];
export type TutorialStatus =
  "NOT_STARTED" | "IN_PROGRESS" | "SKIPPED" | "COMPLETED";
export interface TutorialProgressDto {
  version: 1;
  status: TutorialStatus;
  stepId: TutorialStepId;
}
export interface SaveTutorialProgressInput {
  version: 1;
  status: Exclude<TutorialStatus, "NOT_STARTED">;
  stepId: TutorialStepId;
}

export function assertTutorialProgressInput(
  input: unknown,
): asserts input is SaveTutorialProgressInput {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("El progreso del tutorial no es válido.");
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "status,stepId,version" ||
    value.version !== 1 ||
    typeof value.status !== "string" ||
    !["IN_PROGRESS", "SKIPPED", "COMPLETED"].includes(value.status) ||
    !TUTORIAL_STEP_IDS.includes(value.stepId as TutorialStepId)
  ) {
    throw new Error("El progreso del tutorial no es válido.");
  }
}
