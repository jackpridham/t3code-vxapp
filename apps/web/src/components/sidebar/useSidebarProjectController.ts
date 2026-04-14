import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import { DEFAULT_MODEL_BY_PROVIDER, type ProjectId, ThreadId } from "@t3tools/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  normalizeOrchestratorDisplayName,
  normalizeOrchestratorLabel,
} from "@t3tools/shared/orchestrator";
import { type SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import {
  resolveLatestActiveThreadForProject,
  resolveSidebarProjectKind,
  sortThreadsForSidebar,
  type SidebarProjectKind,
} from "../Sidebar.logic";
import { readNativeApi } from "../../nativeApi";
import { newCommandId, newProjectId } from "../../lib/utils";
import { toastManager } from "../ui/toast";
import { useStore } from "../../store";
import type { DraftThreadEnvMode } from "../../composerDraftStore";
import type { Project, Thread } from "../../types";
import { createNewOrchestrationSession } from "./orchestrationModeActions";
import { loadCurrentStateWithThreadDetail } from "../../lib/orchestrationCurrentStateHydration";

type ProjectDraftThread = {
  threadId: ThreadId;
} | null;

type ThreadLike = Pick<
  Thread,
  "id" | "projectId" | "archivedAt" | "createdAt" | "updatedAt" | "session"
>;

export interface UseSidebarProjectControllerInput<TThread extends ThreadLike> {
  projects: readonly Project[];
  threads: readonly TThread[];
  orchestratorProjectCwds: ReadonlySet<string> | readonly string[];
  sidebarThreadSortOrder: SidebarThreadSortOrder;
  defaultThreadEnvMode: DraftThreadEnvMode;
  defaultNewThreadEnvMode: DraftThreadEnvMode;
  shouldBrowseForProjectImmediately: boolean;
  navigateToSelectedThread: (threadId: ThreadId) => Promise<void>;
  handleNewThread: (
    projectId: ProjectId,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
    },
  ) => Promise<void>;
  archiveThread: (threadId: ThreadId) => Promise<void>;
  getDraftThreadByProjectId: (projectId: ProjectId) => ProjectDraftThread;
  clearComposerDraftForThread: (threadId: ThreadId) => void;
  clearProjectDraftThreadId: (projectId: ProjectId) => void;
  markProjectOrchestratorCwd: (cwd: string) => void;
  copyPathToClipboard: (text: string, data?: { path?: string }) => void;
  persistCurrentOrchestrationSessionRoot?: (
    projectId: ProjectId,
    rootThreadId: ThreadId | null,
  ) => Promise<void>;
}

export interface UseSidebarProjectControllerResult {
  addProjectError: string | null;
  addingProject: boolean;
  canAddProject: boolean;
  isAddingProject: boolean;
  isPickingFolder: boolean;
  newCwd: string;
  newProjectKind: SidebarProjectKind;
  newOrchestratorName: string;
  addProjectInputRef: RefObject<HTMLInputElement | null>;
  setAddingProject: Dispatch<SetStateAction<boolean>>;
  setAddProjectError: Dispatch<SetStateAction<string | null>>;
  setNewCwd: Dispatch<SetStateAction<string>>;
  setNewOrchestratorName: Dispatch<SetStateAction<string>>;
  handleAddProject: (projectKind: SidebarProjectKind) => void;
  handlePickFolder: (projectKind: SidebarProjectKind) => Promise<void>;
  handleStartAddProject: (projectKind: SidebarProjectKind) => void;
  handleProjectContextMenu: (
    projectId: ProjectId,
    position: { x: number; y: number },
  ) => Promise<void>;
  handleSidebarNewThread: (
    projectId: ProjectId,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
    },
  ) => Promise<void>;
  openOrCreateOrchestratorSession: (projectId: ProjectId) => Promise<void>;
  restartOrchestratorSession: (projectId: ProjectId) => Promise<void>;
  attemptArchiveThread: (threadId: ThreadId) => Promise<void>;
}

export function useSidebarProjectController<TThread extends ThreadLike>(
  input: UseSidebarProjectControllerInput<TThread>,
): UseSidebarProjectControllerResult {
  const queryClient = useQueryClient();
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectKind, setNewProjectKind] = useState<SidebarProjectKind>("project");
  const [newOrchestratorName, setNewOrchestratorName] = useState("");
  const [newCwd, setNewCwd] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const addProjectInputRef = useRef<HTMLInputElement | null>(null);

  const handleSidebarNewThread = useCallback(
    async (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ) => {
      await input.handleNewThread(projectId, options);
    },
    [input],
  );

  const attemptArchiveThread = useCallback(
    async (threadId: ThreadId) => {
      try {
        await input.archiveThread(threadId);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to archive thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [input],
  );

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = sortThreadsForSidebar(
        input.threads.filter(
          (thread) => thread.projectId === projectId && thread.archivedAt === null,
        ),
        input.sidebarThreadSortOrder,
      )[0];
      if (!latestThread) return;

      void input.navigateToSelectedThread(latestThread.id);
    },
    [input],
  );

  const getLatestActiveThreadForProject = useCallback(
    (projectId: ProjectId) =>
      resolveLatestActiveThreadForProject({
        projectId,
        threads: input.threads,
        sortOrder: input.sidebarThreadSortOrder,
      }),
    [input],
  );

  const openOrCreateOrchestratorSession = useCallback(
    async (projectId: ProjectId) => {
      const draftThread = input.getDraftThreadByProjectId(projectId);
      if (draftThread) {
        await input.navigateToSelectedThread(draftThread.threadId);
        return;
      }

      const latestThread = getLatestActiveThreadForProject(projectId);
      if (latestThread) {
        if (input.persistCurrentOrchestrationSessionRoot) {
          await input.persistCurrentOrchestrationSessionRoot(projectId, latestThread.id);
        }
        await input.navigateToSelectedThread(latestThread.id);
        return;
      }

      const api = readNativeApi();
      if (!api) {
        await handleSidebarNewThread(projectId, {
          envMode: input.defaultThreadEnvMode,
        });
        return;
      }

      try {
        const latestServerThread = resolveLatestActiveThreadForProject({
          projectId,
          threads: await api.orchestration.listProjectThreads({
            projectId,
            includeArchived: false,
            includeDeleted: false,
          }),
          sortOrder: input.sidebarThreadSortOrder,
        });
        if (latestServerThread) {
          if (input.persistCurrentOrchestrationSessionRoot) {
            await input.persistCurrentOrchestrationSessionRoot(projectId, latestServerThread.id);
          }
          const alreadyHydrated = useStore
            .getState()
            .threads.some((thread) => thread.id === latestServerThread.id);
          if (!alreadyHydrated) {
            const readModel = await loadCurrentStateWithThreadDetail(api, latestServerThread.id);
            useStore.getState().syncServerReadModel(readModel);
          }
          await input.navigateToSelectedThread(latestServerThread.id);
          return;
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to load orchestrator session",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
        return;
      }

      await handleSidebarNewThread(projectId, {
        envMode: input.defaultThreadEnvMode,
      });
    },
    [getLatestActiveThreadForProject, handleSidebarNewThread, input],
  );

  const restartOrchestratorSession = useCallback(
    async (projectId: ProjectId) => {
      const api = readNativeApi();
      if (!api) return;

      try {
        const existingDraftThread = input.getDraftThreadByProjectId(projectId);
        if (existingDraftThread) {
          input.clearComposerDraftForThread(existingDraftThread.threadId);
          input.clearProjectDraftThreadId(projectId);
        }

        const project = input.projects.find((entry) => entry.id === projectId);
        if (!project) {
          return;
        }
        await createNewOrchestrationSession({
          api,
          queryClient,
          projectId,
          projectName: project.name,
          projectModelSelection: project.defaultModelSelection ?? {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          syncServerReadModel: useStore.getState().syncServerReadModel,
          navigateToThread: input.navigateToSelectedThread,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to restart orchestrator session",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [input, queryClient],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string, projectKind: SidebarProjectKind, rawOrchestratorName?: string) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setNewOrchestratorName("");
        setAddProjectError(null);
        setAddingProject(false);
        setNewProjectKind("project");
      };

      const resolvedOrchestratorName =
        projectKind === "orchestrator"
          ? (normalizeOrchestratorDisplayName(rawOrchestratorName) ??
            cwd.split(/[/\\]/).findLast(isNonEmptyString) ??
            cwd)
          : null;
      const normalizedOrchestratorName =
        projectKind === "orchestrator"
          ? normalizeOrchestratorLabel(resolvedOrchestratorName)
          : null;

      if (projectKind === "orchestrator" && normalizedOrchestratorName !== null) {
        const existingByName = input.projects.find((project) => {
          if (
            resolveSidebarProjectKind({
              project,
              orchestratorProjectCwds: input.orchestratorProjectCwds,
            }) !== "orchestrator"
          ) {
            return false;
          }
          return normalizeOrchestratorLabel(project.name) === normalizedOrchestratorName;
        });

        if (existingByName && existingByName.cwd !== cwd) {
          await openOrCreateOrchestratorSession(existingByName.id);
          finishAddingProject();
          return;
        }
      }

      const existing = input.projects.find((project) => project.cwd === cwd);
      if (existing) {
        if (projectKind === "orchestrator") {
          await api.orchestration.dispatchCommand({
            type: "project.meta.update",
            commandId: newCommandId(),
            projectId: existing.id,
            kind: "orchestrator",
            ...(resolvedOrchestratorName !== null ? { title: resolvedOrchestratorName } : {}),
          } as never);
          input.markProjectOrchestratorCwd(cwd);
          await openOrCreateOrchestratorSession(existing.id);
        } else {
          focusMostRecentThreadForProject(existing.id);
        }
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title =
        resolvedOrchestratorName ?? cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      try {
        const createCommand = {
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          createdAt,
        };
        await api.orchestration.dispatchCommand(
          (projectKind === "orchestrator"
            ? { ...createCommand, kind: "orchestrator" }
            : createCommand) as never,
        );
        await handleSidebarNewThread(projectId, {
          envMode: input.defaultNewThreadEnvMode,
        });
      } catch (error) {
        const description =
          error instanceof Error
            ? error.message
            : `An error occurred while adding the ${projectKind === "orchestrator" ? "orchestrator" : "project"}.`;
        setIsAddingProject(false);
        if (input.shouldBrowseForProjectImmediately) {
          toastManager.add({
            type: "error",
            title:
              projectKind === "orchestrator"
                ? "Failed to add orchestrator"
                : "Failed to add project",
            description,
          });
        } else {
          setAddProjectError(description);
        }
        return;
      }

      if (projectKind === "orchestrator") {
        input.markProjectOrchestratorCwd(cwd);
      }
      finishAddingProject();
    },
    [
      focusMostRecentThreadForProject,
      handleSidebarNewThread,
      input,
      isAddingProject,
      openOrCreateOrchestratorSession,
    ],
  );

  const handleAddProject = useCallback(
    (projectKind: SidebarProjectKind) => {
      void addProjectFromPath(newCwd, projectKind, newOrchestratorName);
    },
    [addProjectFromPath, newCwd, newOrchestratorName],
  );

  const handlePickFolder = useCallback(
    async (projectKind: SidebarProjectKind) => {
      const api = readNativeApi();
      if (!api || isPickingFolder) return;
      setIsPickingFolder(true);
      let pickedPath: string | null = null;
      try {
        pickedPath = await api.dialogs.pickFolder();
      } catch {
        // Ignore picker failures and leave the current thread selection unchanged.
      }
      if (pickedPath) {
        await addProjectFromPath(pickedPath, projectKind, newOrchestratorName);
      } else if (!input.shouldBrowseForProjectImmediately) {
        addProjectInputRef.current?.focus();
      }
      setIsPickingFolder(false);
    },
    [
      addProjectFromPath,
      input.shouldBrowseForProjectImmediately,
      isPickingFolder,
      newOrchestratorName,
    ],
  );

  const handleStartAddProject = useCallback(
    (projectKind: SidebarProjectKind) => {
      const isTogglingCurrentForm = addingProject && newProjectKind === projectKind;
      if (isTogglingCurrentForm) {
        setAddingProject(false);
        setAddProjectError(null);
        setNewCwd("");
        setNewOrchestratorName("");
        return;
      }
      setAddProjectError(null);
      setNewProjectKind(projectKind);
      if (input.shouldBrowseForProjectImmediately && projectKind === "project") {
        void handlePickFolder(projectKind);
        return;
      }
      setAddingProject((current) => !(current && newProjectKind === projectKind));
    },
    [addingProject, handlePickFolder, input.shouldBrowseForProjectImmediately, newProjectKind],
  );

  const handleProjectContextMenu = useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const project = input.projects.find((entry) => entry.id === projectId);
      if (!project) return;

      const clicked = await api.contextMenu.show(
        [
          { id: "copy-path", label: "Copy Project Path" },
          { id: "assign-parent", label: "Assign Parent Project" },
          { id: "delete", label: "Remove project", destructive: true },
        ],
        position,
      );
      if (clicked === "copy-path") {
        input.copyPathToClipboard(project.cwd, { path: project.cwd });
        return;
      }
      if (clicked === "assign-parent") {
        toastManager.add({
          type: "info",
          title: "Assign parent project",
          description: `TODO: parent project picker for "${project.name}" is not wired yet.`,
        });
        return;
      }
      if (clicked !== "delete") return;

      const projectThreads = input.threads.filter((thread) => thread.projectId === projectId);
      if (projectThreads.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads in this project before removing it.",
        });
        return;
      }

      const confirmed = await api.dialogs.confirm(`Remove project "${project.name}"?`);
      if (!confirmed) return;

      try {
        const projectDraftThread = input.getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          input.clearComposerDraftForThread(projectDraftThread.threadId);
        }
        input.clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: `Failed to remove "${project.name}"`,
          description: message,
        });
      }
    },
    [input],
  );

  const canAddProject =
    newCwd.trim().length > 0 &&
    !isAddingProject &&
    (newProjectKind !== "orchestrator" ||
      normalizeOrchestratorDisplayName(newOrchestratorName) !== null);

  return {
    addProjectError,
    addingProject,
    canAddProject,
    isAddingProject,
    isPickingFolder,
    newCwd,
    newProjectKind,
    newOrchestratorName,
    addProjectInputRef,
    setAddingProject,
    setAddProjectError,
    setNewCwd,
    setNewOrchestratorName,
    handleAddProject,
    handlePickFolder,
    handleStartAddProject,
    handleProjectContextMenu,
    handleSidebarNewThread,
    openOrCreateOrchestratorSession,
    restartOrchestratorSession,
    attemptArchiveThread,
  };
}
