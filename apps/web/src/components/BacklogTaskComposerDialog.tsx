import {
  DEFAULT_MODEL,
  type ApprovalRequestId,
  type ModelSelection,
  type ProviderApprovalDecision,
  ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { useCallback, useMemo, useRef, useState } from "react";
import { type BacklogTaskId, deriveBacklogTaskTitle, useBacklogTaskStore } from "../backlogTasks";
import {
  type ComposerImageAttachment,
  useComposerDraftStore,
  type DraftId,
} from "../composerDraftStore";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useSavedEnvironmentRuntimeStore } from "../environments/runtime";
import { useGitStatus } from "../lib/gitStatusState";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import { stripInlineTerminalContextPlaceholders } from "../lib/terminalContext";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import { useStore } from "../store";
import { createProjectSelectorByRef } from "../storeSelectors";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "../types";
import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { useServerConfig, useServerKeybindings } from "../rpc/serverState";
import { buildLocalDraftThread } from "./ChatView.logic";
import { BranchToolbar } from "./BranchToolbar";
import type { EnvMode, EnvironmentOption } from "./BranchToolbar.logic";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";
import { stackedThreadToast, toastManager } from "./ui/toast";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import type { TerminalContextDraft } from "../lib/terminalContext";

const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_THREAD_ACTIVITIES: Thread["activities"] = [];

interface BacklogTaskComposerDialogProps {
  project: SidebarProjectSnapshot;
  taskId: BacklogTaskId;
  draftId: DraftId;
  open: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

function useDialogDraftThread(draftId: DraftId) {
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const projectRef = useMemo(
    () =>
      draftSession ? scopeProjectRef(draftSession.environmentId, draftSession.projectId) : null,
    [draftSession],
  );
  const projectSelector = useMemo(() => createProjectSelectorByRef(projectRef), [projectRef]);
  const activeProject = useStore(projectSelector);
  return { draftSession, activeProject };
}

export function BacklogTaskComposerDialog({
  project,
  taskId,
  draftId,
  open,
  onCancel,
  onSaved,
}: BacklogTaskComposerDialogProps) {
  const { draftSession, activeProject } = useDialogDraftThread(draftId);
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(draftId)?.runtimeMode ?? null,
  );
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(draftId)?.interactionMode ?? null,
  );
  const settings = useSettings();
  const keybindings = useServerKeybindings();
  const serverConfig = useServerConfig();
  const { resolvedTheme } = useTheme();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((store) => store.byId);
  const providerStatuses =
    (draftSession
      ? savedEnvironmentRuntimeById[draftSession.environmentId]?.serverConfig?.providers
      : null) ??
    serverConfig?.providers ??
    EMPTY_PROVIDERS;
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const upsertBacklogTask = useBacklogTaskStore((store) => store.upsertTask);
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const shouldAutoScrollRef = useRef(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);

  const localDraftThread = useMemo(
    () =>
      draftSession && activeProject
        ? buildLocalDraftThread(
            draftSession.threadId,
            draftSession,
            activeProject.defaultModelSelection ?? {
              instanceId: ProviderInstanceId.make("codex"),
              model: DEFAULT_MODEL,
            },
            localError,
          )
        : undefined,
    [activeProject, draftSession, localError],
  );
  const runtimeMode = composerRuntimeMode ?? localDraftThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerInteractionMode ?? localDraftThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const threadRef = useMemo(
    () =>
      draftSession
        ? scopeThreadRef(draftSession.environmentId, draftSession.threadId)
        : scopeThreadRef(project.environmentId, ThreadId.make("backlog-draft-placeholder")),
    [draftSession, project.environmentId],
  );
  const gitCwd =
    activeProject && draftSession
      ? projectScriptCwd({
          project: { cwd: activeProject.cwd },
          worktreePath: draftSession.worktreePath,
        })
      : null;
  const gitStatusQuery = useGitStatus({
    environmentId: draftSession?.environmentId ?? project.environmentId,
    cwd: gitCwd,
  });
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const availableEnvironments = useMemo<EnvironmentOption[]>(
    () =>
      project.memberProjects.map((member) => {
        const runtimeLabel =
          savedEnvironmentRuntimeById[member.environmentId]?.descriptor?.label ?? null;
        return {
          environmentId: member.environmentId,
          projectId: member.id,
          label: runtimeLabel ?? member.environmentLabel ?? member.environmentId,
          isPrimary: member.environmentId === primaryEnvironmentId,
        };
      }),
    [primaryEnvironmentId, project.memberProjects, savedEnvironmentRuntimeById],
  );

  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      composerRef.current?.focusAtEnd();
    });
  }, []);
  const handleProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (!resolvedModel) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(draftId, nextModelSelection);
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      draftId,
      providerStatuses,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      settings,
    ],
  );
  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      setComposerDraftRuntimeMode(draftId, mode);
      setDraftThreadContext(draftId, { runtimeMode: mode });
      scheduleComposerFocus();
    },
    [draftId, scheduleComposerFocus, setComposerDraftRuntimeMode, setDraftThreadContext],
  );
  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      setComposerDraftInteractionMode(draftId, mode);
      setDraftThreadContext(draftId, { interactionMode: mode });
      scheduleComposerFocus();
    },
    [draftId, scheduleComposerFocus, setComposerDraftInteractionMode, setDraftThreadContext],
  );
  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode]);
  const onEnvModeChange = useCallback(
    (mode: EnvMode) => {
      setDraftThreadContext(draftId, {
        envMode: mode,
        ...(mode === "worktree" && draftSession?.worktreePath ? { worktreePath: null } : {}),
      });
      scheduleComposerFocus();
    },
    [draftId, draftSession?.worktreePath, scheduleComposerFocus, setDraftThreadContext],
  );
  const onEnvironmentChange = useCallback(
    (environmentId: string) => {
      const target = availableEnvironments.find((entry) => entry.environmentId === environmentId);
      if (!target) {
        return;
      }
      setDraftThreadContext(draftId, {
        projectRef: scopeProjectRef(target.environmentId, target.projectId),
      });
    },
    [availableEnvironments, draftId, setDraftThreadContext],
  );
  const onSave = useCallback(
    (event?: { preventDefault: () => void }) => {
      event?.preventDefault();
      const sendContext = composerRef.current?.getSendContext();
      const currentDraftSession = useComposerDraftStore.getState().getDraftSession(draftId);
      if (!sendContext || !currentDraftSession) {
        return;
      }
      const trimmedPrompt = stripInlineTerminalContextPlaceholders(sendContext.prompt).trim();
      if (trimmedPrompt.length === 0) {
        toastManager.add({
          type: "error",
          title: "Prompt required",
          description: "Add a prompt before saving this backlog task.",
        });
        return;
      }
      const now = new Date().toISOString();
      setComposerDraftModelSelection(draftId, sendContext.selectedModelSelection);
      setStickyComposerModelSelection(sendContext.selectedModelSelection);
      setDraftThreadContext(draftId, { runtimeMode, interactionMode });
      upsertBacklogTask({
        id: taskId,
        projectKey: project.projectKey,
        draftId,
        title: deriveBacklogTaskTitle(trimmedPrompt),
        createdAt: now,
        updatedAt: now,
        runtimeMode,
        interactionMode,
        modelSelection: sendContext.selectedModelSelection,
        providerDriver: sendContext.selectedProvider,
        promptEffort: sendContext.selectedPromptEffort,
      });
      onSaved();
    },
    [
      draftId,
      interactionMode,
      onSaved,
      project.projectKey,
      runtimeMode,
      setComposerDraftModelSelection,
      setDraftThreadContext,
      setStickyComposerModelSelection,
      taskId,
      upsertBacklogTask,
    ],
  );
  const setThreadError = useCallback((_threadId: ThreadId | null, error: string | null) => {
    setLocalError(error);
    if (error) {
      toastManager.add(stackedThreadToast({ type: "error", title: error }));
    }
  }, []);

  if (!draftSession || !activeProject || !localDraftThread) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
        <DialogPopup
          showCloseButton={false}
          bottomStickOnMobile={false}
          viewportClassName="grid-rows-[1fr_auto_1fr] bg-black/20 backdrop-blur-[2px]"
          className="w-[min(56rem,calc(100vw-2rem))] max-w-none overflow-visible bg-popover/96 p-3 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.5)] max-sm:w-[calc(100vw-1rem)] sm:p-4"
        >
          <DialogTitle className="sr-only">Save backlog task</DialogTitle>
          <div className="relative isolate">
            <div className="relative z-10">
              <ChatComposer
                formClassName="max-w-none"
                composerRef={composerRef}
                composerDraftTarget={draftId}
                environmentId={draftSession.environmentId}
                routeKind="draft"
                routeThreadRef={threadRef}
                draftId={draftId}
                activeThreadId={localDraftThread.id}
                activeThreadEnvironmentId={localDraftThread.environmentId}
                activeThread={localDraftThread}
                isServerThread={false}
                isLocalDraftThread
                phase="disconnected"
                isConnecting={false}
                isSendBusy={false}
                isPreparingWorktree={false}
                environmentUnavailable={null}
                activePendingApproval={null}
                pendingApprovals={[]}
                pendingUserInputs={[]}
                activePendingProgress={null}
                activePendingResolvedAnswers={null}
                activePendingIsResponding={false}
                activePendingDraftAnswers={{}}
                activePendingQuestionIndex={0}
                respondingRequestIds={[]}
                showPlanFollowUpPrompt={false}
                activeProposedPlan={null}
                activePlan={null}
                sidebarProposedPlan={null}
                planSidebarLabel="Tasks"
                planSidebarOpen={false}
                runtimeMode={runtimeMode}
                interactionMode={interactionMode}
                lockedProvider={null}
                providerStatuses={providerStatuses as ServerProvider[]}
                activeProjectDefaultModelSelection={activeProject.defaultModelSelection}
                activeThreadModelSelection={localDraftThread.modelSelection}
                activeThreadActivities={EMPTY_THREAD_ACTIVITIES}
                idleSubmitLabel="Save"
                idleSubmitBusyLabel="Saving..."
                idleSubmitIcon="check"
                idleSubmitRequiresPrompt
                resolvedTheme={resolvedTheme}
                settings={settings}
                keybindings={keybindings}
                terminalOpen={false}
                gitCwd={gitCwd}
                promptRef={promptRef}
                composerImagesRef={composerImagesRef}
                composerTerminalContextsRef={composerTerminalContextsRef}
                shouldAutoScrollRef={shouldAutoScrollRef}
                scheduleStickToBottom={() => undefined}
                onSend={onSave}
                onInterrupt={() => undefined}
                onImplementPlanInNewThread={() => undefined}
                onRespondToApproval={async (
                  _requestId: ApprovalRequestId,
                  _decision: ProviderApprovalDecision,
                ) => undefined}
                onSelectActivePendingUserInputOption={() => undefined}
                onAdvanceActivePendingUserInput={() => undefined}
                onPreviousActivePendingUserInputQuestion={() => undefined}
                onChangeActivePendingUserInputCustomAnswer={() => undefined}
                onProviderModelSelect={handleProviderModelSelect}
                toggleInteractionMode={toggleInteractionMode}
                handleRuntimeModeChange={handleRuntimeModeChange}
                handleInteractionModeChange={handleInteractionModeChange}
                togglePlanSidebar={() => undefined}
                focusComposer={scheduleComposerFocus}
                scheduleComposerFocus={scheduleComposerFocus}
                setThreadError={setThreadError}
                onExpandImage={setExpandedImage}
              />
            </div>
            {isGitRepo ? (
              <div className="relative z-0 -mt-4 mx-auto w-[calc(100%-2rem)] max-w-208 rounded-b-[20px] border border-border bg-card/80 pt-4 shadow-sm">
                <BranchToolbar
                  environmentId={draftSession.environmentId}
                  threadId={draftSession.threadId}
                  draftId={draftId}
                  onEnvModeChange={onEnvModeChange}
                  envLocked={false}
                  onComposerFocusRequest={scheduleComposerFocus}
                  availableEnvironments={availableEnvironments}
                  onEnvironmentChange={onEnvironmentChange}
                />
              </div>
            ) : null}
          </div>
        </DialogPopup>
      </Dialog>
      {expandedImage ? (
        <ExpandedImageDialog preview={expandedImage} onClose={() => setExpandedImage(null)} />
      ) : null}
    </>
  );
}
