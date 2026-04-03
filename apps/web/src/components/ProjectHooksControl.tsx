import type {
  BeforePromptProjectHook,
  ProjectHook,
  ProjectHookExecutionTarget,
  ProjectHookOutputCapture,
  ProjectHookOutputPlacement,
  ProjectHookPromptErrorMode,
  ProjectHookTurnState,
  TurnCompletedProjectHook,
} from "@t3tools/contracts";
import { ChevronDownIcon, PlusIcon, Settings2Icon, WorkflowIcon } from "lucide-react";
import React, { type FormEvent, useMemo, useState } from "react";
import {
  describeProjectHook,
  PROJECT_HOOK_ERROR_MODE_LABELS,
  PROJECT_HOOK_EXECUTION_TARGET_LABELS,
  PROJECT_HOOK_OUTPUT_CAPTURE_LABELS,
  PROJECT_HOOK_OUTPUT_PLACEMENT_LABELS,
  PROJECT_HOOK_TRIGGER_LABELS,
  PROJECT_HOOK_TURN_STATE_LABELS,
} from "~/projectHooks";
import type { NewProjectHookInput } from "~/projectHooks";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

type ProjectHookTrigger = ProjectHook["trigger"];
type ProviderFilter = "any" | "codex" | "claudeAgent";
type InteractionModeFilter = "any" | "default" | "plan";
type RuntimeModeFilter = "any" | "approval-required" | "full-access";
type TurnStateFilter = "any" | ProjectHookTurnState;

interface ProjectHooksControlProps {
  hooks: ProjectHook[];
  onAddHook: (input: NewProjectHookInput) => Promise<void> | void;
  onUpdateHook: (hookId: string, input: NewProjectHookInput) => Promise<void> | void;
  onDeleteHook: (hookId: string) => Promise<void> | void;
}

export type { NewProjectHookInput } from "~/projectHooks";

const EXECUTION_TARGET_OPTIONS: ProjectHookExecutionTarget[] = [
  "project-root-or-worktree",
  "project-root",
  "worktree",
];
const OUTPUT_CAPTURE_OPTIONS: ProjectHookOutputCapture[] = ["stdout", "stderr", "combined", "none"];
const OUTPUT_PLACEMENT_OPTIONS: ProjectHookOutputPlacement[] = ["ignore", "before", "after"];
const ERROR_MODE_OPTIONS: ProjectHookPromptErrorMode[] = ["fail", "continue"];
const TURN_STATE_OPTIONS: ProjectHookTurnState[] = [
  "completed",
  "failed",
  "interrupted",
  "cancelled",
];

export default function ProjectHooksControl({
  hooks,
  onAddHook,
  onUpdateHook,
  onDeleteHook,
}: ProjectHooksControlProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingHookId, setEditingHookId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<ProjectHookTrigger>("before-prompt");
  const [enabled, setEnabled] = useState(true);
  const [command, setCommand] = useState("");
  const [executionTarget, setExecutionTarget] = useState<ProjectHookExecutionTarget>(
    "project-root-or-worktree",
  );
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("any");
  const [interactionModeFilter, setInteractionModeFilter] = useState<InteractionModeFilter>("any");
  const [runtimeModeFilter, setRuntimeModeFilter] = useState<RuntimeModeFilter>("any");
  const [turnStateFilter, setTurnStateFilter] = useState<TurnStateFilter>("any");
  const [capture, setCapture] = useState<ProjectHookOutputCapture>("stdout");
  const [placement, setPlacement] = useState<ProjectHookOutputPlacement>("ignore");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [onError, setOnError] = useState<ProjectHookPromptErrorMode>("fail");
  const [validationError, setValidationError] = useState<string | null>(null);

  const hookCountLabel = useMemo(() => {
    if (hooks.length === 0) return "Hooks";
    return hooks.length === 1 ? "1 hook" : `${hooks.length} hooks`;
  }, [hooks.length]);

  const resetForm = () => {
    setEditingHookId(null);
    setName("");
    setTrigger("before-prompt");
    setEnabled(true);
    setCommand("");
    setExecutionTarget("project-root-or-worktree");
    setProviderFilter("any");
    setInteractionModeFilter("any");
    setRuntimeModeFilter("any");
    setTurnStateFilter("any");
    setCapture("stdout");
    setPlacement("ignore");
    setPrefix("");
    setSuffix("");
    setOnError("fail");
    setValidationError(null);
  };

  const openAddDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (hook: ProjectHook) => {
    setEditingHookId(hook.id);
    setName(hook.name);
    setTrigger(hook.trigger);
    setEnabled(hook.enabled);
    setCommand(hook.command);
    setExecutionTarget(hook.executionTarget);
    setProviderFilter(hook.selectors.providers[0] ?? "any");
    setInteractionModeFilter(hook.selectors.interactionModes[0] ?? "any");
    setRuntimeModeFilter(hook.selectors.runtimeModes[0] ?? "any");
    setTurnStateFilter(hook.selectors.turnStates[0] ?? "any");
    if (hook.trigger === "before-prompt") {
      setCapture(hook.output.capture);
      setPlacement(hook.output.placement);
      setPrefix(hook.output.prefix);
      setSuffix(hook.output.suffix);
      setOnError(hook.onError);
    } else {
      setCapture("stdout");
      setPlacement("ignore");
      setPrefix("");
      setSuffix("");
      setOnError("fail");
    }
    setValidationError(null);
    setDialogOpen(true);
  };

  const buildInput = (): NewProjectHookInput => {
    const selectors = {
      providers: providerFilter === "any" ? [] : [providerFilter],
      interactionModes: interactionModeFilter === "any" ? [] : [interactionModeFilter],
      runtimeModes: runtimeModeFilter === "any" ? [] : [runtimeModeFilter],
      turnStates: turnStateFilter === "any" ? [] : [turnStateFilter],
    };

    if (trigger === "before-prompt") {
      return {
        trigger,
        name: name.trim(),
        enabled,
        command: command.trim(),
        executionTarget,
        timeoutMs: 15_000,
        selectors,
        onError,
        output: {
          capture,
          placement,
          prefix,
          suffix,
        },
      } satisfies Omit<BeforePromptProjectHook, "id">;
    }

    return {
      trigger,
      name: name.trim(),
      enabled,
      command: command.trim(),
      executionTarget,
      timeoutMs: 15_000,
      selectors,
    } satisfies Omit<TurnCompletedProjectHook, "id">;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (command.trim().length === 0) {
      setValidationError("Command is required.");
      return;
    }
    setValidationError(null);
    const input = buildInput();
    if (editingHookId) {
      await onUpdateHook(editingHookId, input);
    } else {
      await onAddHook(input);
    }
    setDialogOpen(false);
  };

  const confirmDelete = () => {
    if (!editingHookId) return;
    setDeleteConfirmOpen(false);
    setDialogOpen(false);
    void onDeleteHook(editingHookId);
  };

  return (
    <>
      <Menu highlightItemOnHover={false}>
        <MenuTrigger render={<Button size="xs" variant="outline" aria-label="Project hooks" />}>
          <WorkflowIcon className="size-3.5" />
          <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
            {hookCountLabel}
          </span>
          <ChevronDownIcon className="size-3.5 opacity-70" />
        </MenuTrigger>
        <MenuPopup align="end">
          {hooks.map((hook) => (
            <MenuItem key={hook.id} onClick={() => openEditDialog(hook)}>
              <Settings2Icon className="size-4" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{hook.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {describeProjectHook(hook)}
                </span>
              </span>
            </MenuItem>
          ))}
          <MenuItem onClick={openAddDialog}>
            <PlusIcon className="size-4" />
            Add hook
          </MenuItem>
        </MenuPopup>
      </Menu>

      <Dialog
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setDeleteConfirmOpen(false);
          }
        }}
        onOpenChangeComplete={(open) => {
          if (open) return;
          resetForm();
        }}
        open={dialogOpen}
      >
        <DialogPopup className="max-w-2xl">
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>{editingHookId ? "Edit project hook" : "Add project hook"}</DialogTitle>
              <DialogDescription>
                Run a server-side command for this project before prompts are sent or after turns
                complete.
              </DialogDescription>
            </DialogHeader>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="project-hook-name">Name</Label>
                  <Input
                    id="project-hook-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Search Context"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-hook-trigger">Trigger</Label>
                  <Select
                    value={trigger}
                    onValueChange={(value) => {
                      if (value === "before-prompt" || value === "turn-completed") {
                        setTrigger(value);
                      }
                    }}
                  >
                    <SelectTrigger id="project-hook-trigger">
                      <SelectValue>{PROJECT_HOOK_TRIGGER_LABELS[trigger]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="before-prompt">
                        {PROJECT_HOOK_TRIGGER_LABELS["before-prompt"]}
                      </SelectItem>
                      <SelectItem hideIndicator value="turn-completed">
                        {PROJECT_HOOK_TRIGGER_LABELS["turn-completed"]}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="project-hook-command">Command</Label>
                <Textarea
                  id="project-hook-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="python scripts/context.py"
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  The command runs on the server. Hook context is provided on stdin as JSON.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Enabled</p>
                  <p className="text-xs text-muted-foreground">
                    Disable this hook without deleting its configuration.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Run In</Label>
                  <Select
                    value={executionTarget}
                    onValueChange={(value) => {
                      if (
                        value === "project-root" ||
                        value === "worktree" ||
                        value === "project-root-or-worktree"
                      ) {
                        setExecutionTarget(value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {PROJECT_HOOK_EXECUTION_TARGET_LABELS[executionTarget]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {EXECUTION_TARGET_OPTIONS.map((option) => (
                        <SelectItem hideIndicator key={option} value={option}>
                          {PROJECT_HOOK_EXECUTION_TARGET_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Provider Filter</Label>
                  <Select
                    value={providerFilter}
                    onValueChange={(value) => {
                      if (value === "any" || value === "codex" || value === "claudeAgent") {
                        setProviderFilter(value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {providerFilter === "any"
                          ? "Any provider"
                          : providerFilter === "codex"
                            ? "Codex"
                            : "Claude"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="any">
                        Any provider
                      </SelectItem>
                      <SelectItem hideIndicator value="codex">
                        Codex
                      </SelectItem>
                      <SelectItem hideIndicator value="claudeAgent">
                        Claude
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Interaction Mode</Label>
                  <Select
                    value={interactionModeFilter}
                    onValueChange={(value) => {
                      if (value === "any" || value === "default" || value === "plan") {
                        setInteractionModeFilter(value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {interactionModeFilter === "any"
                          ? "Any mode"
                          : interactionModeFilter === "default"
                            ? "Default"
                            : "Plan"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="any">
                        Any mode
                      </SelectItem>
                      <SelectItem hideIndicator value="default">
                        Default
                      </SelectItem>
                      <SelectItem hideIndicator value="plan">
                        Plan
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Runtime Mode</Label>
                  <Select
                    value={runtimeModeFilter}
                    onValueChange={(value) => {
                      if (
                        value === "any" ||
                        value === "approval-required" ||
                        value === "full-access"
                      ) {
                        setRuntimeModeFilter(value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {runtimeModeFilter === "any"
                          ? "Any runtime"
                          : runtimeModeFilter === "approval-required"
                            ? "Approval required"
                            : "Full access"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem hideIndicator value="any">
                        Any runtime
                      </SelectItem>
                      <SelectItem hideIndicator value="approval-required">
                        Approval required
                      </SelectItem>
                      <SelectItem hideIndicator value="full-access">
                        Full access
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
                {trigger === "turn-completed" ? (
                  <div className="space-y-2">
                    <Label>Turn Outcome</Label>
                    <Select
                      value={turnStateFilter}
                      onValueChange={(value) => {
                        if (
                          value === "any" ||
                          value === "completed" ||
                          value === "failed" ||
                          value === "interrupted" ||
                          value === "cancelled"
                        ) {
                          setTurnStateFilter(value);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {turnStateFilter === "any"
                            ? "Any outcome"
                            : PROJECT_HOOK_TURN_STATE_LABELS[turnStateFilter]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        <SelectItem hideIndicator value="any">
                          Any outcome
                        </SelectItem>
                        {TURN_STATE_OPTIONS.map((option) => (
                          <SelectItem hideIndicator key={option} value={option}>
                            {PROJECT_HOOK_TURN_STATE_LABELS[option]}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                ) : null}
              </div>

              {trigger === "before-prompt" ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Capture</Label>
                      <Select
                        value={capture}
                        onValueChange={(value) => {
                          if (
                            value === "stdout" ||
                            value === "stderr" ||
                            value === "combined" ||
                            value === "none"
                          ) {
                            setCapture(value);
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue>{PROJECT_HOOK_OUTPUT_CAPTURE_LABELS[capture]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup align="end" alignItemWithTrigger={false}>
                          {OUTPUT_CAPTURE_OPTIONS.map((option) => (
                            <SelectItem hideIndicator key={option} value={option}>
                              {PROJECT_HOOK_OUTPUT_CAPTURE_LABELS[option]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Prompt Output</Label>
                      <Select
                        value={placement}
                        onValueChange={(value) => {
                          if (value === "ignore" || value === "before" || value === "after") {
                            setPlacement(value);
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {PROJECT_HOOK_OUTPUT_PLACEMENT_LABELS[placement]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup align="end" alignItemWithTrigger={false}>
                          {OUTPUT_PLACEMENT_OPTIONS.map((option) => (
                            <SelectItem hideIndicator key={option} value={option}>
                              {PROJECT_HOOK_OUTPUT_PLACEMENT_LABELS[option]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>On Error</Label>
                      <Select
                        value={onError}
                        onValueChange={(value) => {
                          if (value === "fail" || value === "continue") {
                            setOnError(value);
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue>{PROJECT_HOOK_ERROR_MODE_LABELS[onError]}</SelectValue>
                        </SelectTrigger>
                        <SelectPopup align="end" alignItemWithTrigger={false}>
                          {ERROR_MODE_OPTIONS.map((option) => (
                            <SelectItem hideIndicator key={option} value={option}>
                              {PROJECT_HOOK_ERROR_MODE_LABELS[option]}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="project-hook-prefix">Prefix</Label>
                      <Textarea
                        id="project-hook-prefix"
                        value={prefix}
                        onChange={(event) => setPrefix(event.target.value)}
                        rows={3}
                        placeholder="Context from search:\n"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="project-hook-suffix">Suffix</Label>
                      <Textarea
                        id="project-hook-suffix"
                        value={suffix}
                        onChange={(event) => setSuffix(event.target.value)}
                        rows={3}
                        placeholder="\nEnd of hook output."
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {validationError ? (
                <p className="text-sm text-destructive">{validationError}</p>
              ) : null}

              <DialogFooter className="justify-between">
                <div>
                  {editingHookId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      Delete hook
                    </Button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingHookId ? "Save hook" : "Add hook"}</Button>
                </div>
              </DialogFooter>
            </form>
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project hook?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the hook configuration for this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </AlertDialogClose>
            <Button type="button" variant="destructive" onClick={confirmDelete}>
              Delete hook
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
