import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  ServerCreateAgentsVxappProgramInput,
  ServerCreateAgentsVxappTodoInput,
  ServerDeleteAgentsVxappProgramInput,
  ServerDeleteAgentsVxappTodoInput,
  ServerSetAgentsVxappProgramLifecycleInput,
  ServerUpdateAgentsVxappProgramInput,
  ServerUpdateAgentsVxappTodoInput,
} from "@t3tools/contracts";
import { ensureNativeApi } from "~/nativeApi";
import { agentsVxappSidebarQueryKeys } from "./agentsVxappSidebarReactQuery";

const AGENTS_VXAPP_CONTROL_PLANE_STALE_TIME_MS = 10_000;

export const agentsVxappControlPlaneQueryKeys = {
  all: ["agents-vxapp-control-plane"] as const,
  snapshot: () => ["agents-vxapp-control-plane", "snapshot"] as const,
};

export function invalidateAgentsVxappControlPlaneQueries(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: agentsVxappControlPlaneQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: agentsVxappSidebarQueryKeys.all }),
  ]);
}

export function agentsVxappControlPlaneSnapshotQueryOptions() {
  return queryOptions({
    queryKey: agentsVxappControlPlaneQueryKeys.snapshot(),
    staleTime: AGENTS_VXAPP_CONTROL_PLANE_STALE_TIME_MS,
    queryFn: async () => ensureNativeApi().server.getAgentsVxappControlPlaneSnapshot({}),
  });
}

export function createAgentsVxappProgramMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["agents-vxapp-control-plane", "mutation", "programs", "create"] as const,
    mutationFn: async (request: ServerCreateAgentsVxappProgramInput) =>
      ensureNativeApi().server.createAgentsVxappProgram(request),
    onSettled: async () => {
      await invalidateAgentsVxappControlPlaneQueries(input.queryClient);
    },
  });
}

export function updateAgentsVxappProgramMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["agents-vxapp-control-plane", "mutation", "programs", "update"] as const,
    mutationFn: async (request: ServerUpdateAgentsVxappProgramInput) =>
      ensureNativeApi().server.updateAgentsVxappProgram(request),
    onSettled: async () => {
      await invalidateAgentsVxappControlPlaneQueries(input.queryClient);
    },
  });
}

export function deleteAgentsVxappProgramMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["agents-vxapp-control-plane", "mutation", "programs", "delete"] as const,
    mutationFn: async (request: ServerDeleteAgentsVxappProgramInput) =>
      ensureNativeApi().server.deleteAgentsVxappProgram(request),
    onSettled: async () => {
      await invalidateAgentsVxappControlPlaneQueries(input.queryClient);
    },
  });
}

export function setAgentsVxappProgramLifecycleMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["agents-vxapp-control-plane", "mutation", "programs", "lifecycle"] as const,
    mutationFn: async (request: ServerSetAgentsVxappProgramLifecycleInput) =>
      ensureNativeApi().server.setAgentsVxappProgramLifecycle(request),
    onSettled: async () => {
      await invalidateAgentsVxappControlPlaneQueries(input.queryClient);
    },
  });
}

export function createAgentsVxappTodoMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["agents-vxapp-control-plane", "mutation", "todos", "create"] as const,
    mutationFn: async (request: ServerCreateAgentsVxappTodoInput) =>
      ensureNativeApi().server.createAgentsVxappTodo(request),
    onSettled: async () => {
      await invalidateAgentsVxappControlPlaneQueries(input.queryClient);
    },
  });
}

export function updateAgentsVxappTodoMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["agents-vxapp-control-plane", "mutation", "todos", "update"] as const,
    mutationFn: async (request: ServerUpdateAgentsVxappTodoInput) =>
      ensureNativeApi().server.updateAgentsVxappTodo(request),
    onSettled: async () => {
      await invalidateAgentsVxappControlPlaneQueries(input.queryClient);
    },
  });
}

export function deleteAgentsVxappTodoMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["agents-vxapp-control-plane", "mutation", "todos", "delete"] as const,
    mutationFn: async (request: ServerDeleteAgentsVxappTodoInput) =>
      ensureNativeApi().server.deleteAgentsVxappTodo(request),
    onSettled: async () => {
      await invalidateAgentsVxappControlPlaneQueries(input.queryClient);
    },
  });
}
