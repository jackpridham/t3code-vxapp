import type { ProjectId, ThreadId } from "@t3tools/contracts";

type OwnerProgramWithExecutiveIds<T> = T & {
  readonly executiveProjectId: ProjectId;
  readonly executiveThreadId: ThreadId;
};

export function filterOwnerProgramsWithExecutiveIds<
  T extends {
    readonly executiveProjectId: ProjectId | null;
    readonly executiveThreadId: ThreadId | null;
  },
>(programs: ReadonlyArray<T>): Array<OwnerProgramWithExecutiveIds<T>> {
  return programs.flatMap((program) =>
    program.executiveProjectId !== null && program.executiveThreadId !== null
      ? [program as OwnerProgramWithExecutiveIds<T>]
      : [],
  );
}
