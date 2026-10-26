import type { SavedComposerDraft } from './composer-draft-store';
import type { ComposerAttachment } from './composer-support';
import React, {
  memo,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  DesktopAbortOptions,
  DesktopModelSelection,
  DesktopPromptContent,
  DesktopSubmitOptions,
  SessionSnapshot,
} from '../shared/contract';
import { t } from './i18n';
import { shouldStopComposerGeneration } from './renderer-logic.mjs';
import type { CommandSurface as CommandSurfaceName, SettingsSection } from './slash-commands';
import { touchPrimaryPointer } from './surface-input-focus';
// @ts-expect-error The shared TUI module is plain ESM and has no declaration file.
import { shouldFoldPastedText } from '../../../../src/tui/paste-text-policy.mjs';

// Project-context pill, attachment budget, prompt history and the queued
// follow-up list live in composer-support.tsx.
import { ATTACHMENT_ACCEPT, COMPOSER_PLACEHOLDERS, QueueList, pastedTextFields } from './composer-support';
import { ComposerPastedTextDialog } from './ComposerPastedTextDialog';
import {
  composerDraftAfterScopeChange,
  composerScopeOpensFreshDraft,
  stashComposerDraft,
  stashedComposerDraft,
} from './composer-draft';
import { useComposerDictation } from './use-composer-dictation';
import { useComposerAttachments } from './use-composer-attachments';
import { useComposerCapability } from './use-composer-capability';
import { useComposerExternalDraft } from './use-composer-external-draft';
import { useComposerQueue } from './use-composer-queue';
import { useComposerSubmission } from './use-composer-submission';
import { useComposerKeyboard } from './use-composer-keyboard';
import { useComposerFocus } from './use-composer-focus';
import { useComposerHistory } from './use-composer-history';
import { useComposerIme } from './use-composer-ime';
import { useComposerMessageSelector } from './use-composer-message-selector';
import { useComposerNotice } from './use-composer-notice';
import { useComposerPalettes } from './use-composer-palettes';
import { createSlashExecutor } from './composer-slash-executor';
import { readCachedModelCatalog } from './model-catalog-cache';
import { modelOffersUltrafast } from './model-route-utils';
import {
  AttachmentChips,
  DictationOverlay,
  MentionPalette,
  MessageSelectorPalette,
  SlashPalette,
  composerPlaceholder,
} from './composer-surfaces';
import { ComposerBanners } from './ComposerBanners';
import { ComposerFooter } from './ComposerFooter';
import { CapabilityIcon } from './CapabilityIcon';
import { withComposerModelHandoff, takeComposerModelHandoff } from './composer-model-handoff';
import {
  deleteComposerDraft,
  readComposerDraft,
  rememberComposerDraft,
  saveComposerDraft,
  saveReplacedComposerDraft,
} from './composer-draft-store';
import { readExecutionBudget, saveExecutionBudget, type ExecutionBudget } from './execution-budget-settings';
import { shouldRemoveSelectedSkill, skillTitle, useComposerSkill } from './composer-skill';
import { OPEN_TASK_TOOLS_EVENT } from './workbench-shortcuts';

// Perf diagnostics (MIXDOG_DESKTOP_PERF=1): keystroke→paint latency, logged
// only when a frame is actually slow.
function sampleKeystrokePaint(pending: MutableRefObject<boolean>) {
  if (!window.mixdogDesktop?.perfLog || pending.current) return;
  pending.current = true;
  const inputAt = performance.now();
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      pending.current = false;
      const ms = performance.now() - inputAt;
      if (ms >= 25) window.mixdogDesktop?.perfLog?.(`composer-keystroke paint=${ms.toFixed(0)}ms`);
    })
  );
}

function pastedFiles(clipboard: DataTransfer): File[] {
  const itemFiles = Array.from(clipboard.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  return itemFiles.length ? itemFiles : Array.from(clipboard.files);
}

type ComposerAttachmentsApi = ReturnType<typeof useComposerAttachments>;

/** Clipboard intake: pasted files attach, and a long text paste folds into a
 *  single chip instead of flooding the draft. */
function handleComposerPaste(
  event: React.ClipboardEvent<HTMLTextAreaElement>,
  {
    attachFiles,
    attachmentSequence,
    insertAttachment,
  }: {
    attachFiles: ComposerAttachmentsApi['attachFiles'];
    attachmentSequence: ComposerAttachmentsApi['attachmentSequence'];
    insertAttachment: ComposerAttachmentsApi['insertAttachment'];
  }
) {
  const files = pastedFiles(event.clipboardData);
  if (files.length) {
    event.preventDefault();
    void attachFiles(files);
    return;
  }
  const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
  if (!shouldFoldPastedText(text)) return;
  const id = attachmentSequence.current++;
  const inserted = insertAttachment({
    id,
    ...pastedTextFields(id, text),
    kind: 'text',
    mimeType: 'text/plain',
    source: 'paste',
    chipOnly: true,
  });
  if (inserted) event.preventDefault();
}

/** Identity-scope transition: park the text of the pane being left, then open
 *  the incoming one clean, restored, or with the in-flight text carried over.
 *  Every transient surface (palettes, selector, notice, drag) resets with it. */
function switchComposerIdentity({
  identityScope,
  previousScope,
  textarea,
  draftRef,
  composingRef,
  suppressImeLineBreakRef,
  historyNavigation,
  resetAttachments,
  palettes,
  selector,
  setDraft,
  clearNotice,
  setComposerFocused,
  setDraggingFiles,
}: {
  identityScope: string;
  previousScope: string;
  textarea: { current: HTMLTextAreaElement | null };
  draftRef: { current: string };
  composingRef: { current: boolean };
  suppressImeLineBreakRef: { current: boolean };
  historyNavigation: { current: { index: number; seed: string } };
  resetAttachments(): void;
  palettes: { reset(): void; invalidateSearch(): void };
  selector: { reset(): void };
  setDraft: Dispatch<SetStateAction<string>>;
  clearNotice(): void;
  setComposerFocused(focused: boolean): void;
  setDraggingFiles(dragging: boolean): void;
}) {
  // Park the text the user typed in the tab being left, so returning to
  // that tab hands it back instead of opening empty.
  const leavingElement = textarea.current;
  stashComposerDraft(
    previousScope,
    document.activeElement === leavingElement && leavingElement ? leavingElement.value : draftRef.current
  );
  resetAttachments();
  composingRef.current = false;
  suppressImeLineBreakRef.current = false;
  palettes.invalidateSearch();
  // Scope settles ASYNC after a session switch/promotion; when the user is
  // ALREADY typing in the composer, the in-flight text carries over instead
  // of being wiped (user bug: draft vanished + scroll jumped mid-sentence).
  const typingElement = textarea.current;
  const typingLive = document.activeElement === typingElement;
  // A fresh New Task pane is the exception: it ALWAYS opens clean (user:
  // 새작업 pulled the previous pane's text and attachments along).
  const freshDraft = composerScopeOpensFreshDraft(identityScope);
  setDraft((current) => {
    // A remote snapshot can change scope in the same turn as a native input
    // event. The DOM already owns the newest character while React state may
    // still be one commit behind, so preserve the focused DOM value instead
    // of briefly writing the stale controlled value back into the textarea.
    const next = composerDraftAfterScopeChange({
      currentDraft: current,
      liveDomDraft: typingElement?.value ?? current,
      freshDraft,
      typingLive,
      stashedDraft: stashedComposerDraft(identityScope),
    });
    draftRef.current = next;
    return next;
  });
  clearNotice();
  setComposerFocused(false);
  palettes.reset();
  setDraggingFiles(false);
  selector.reset();
  historyNavigation.current = { index: -1, seed: '' };
}

export type ComposerProps = {
  turnBusy: boolean;
  commandBusy: boolean;
  transitioning: boolean;
  focusRequest: number;
  historyScope: string;
  /** Which conversation this composer paints — the session id, or
   *  `draft:<draftId>` for a New Task pane. State resets key on THIS, not on
   *  historyScope: staging a project on the SAME draft keeps the in-flight
   *  text, while pressing New task mints a new identity that opens clean. */
  identityScope: string;
  recoveryScope: string;
  projectScope: string;
  /** This pane's session, so route changes address it instead of whatever the
   *  window happens to be focused on. */
  sessionId?: string;
  hasConversation: boolean;
  promptHistoryList?: unknown[];
  provider: string;
  model: string;
  effort: string;
  fast: boolean;
  fastCapable: boolean;
  modelParameters?: Record<string, string>;
  contextPercent?: number;
  draftMode?: boolean;
  onDraftModelSelection?: (selection: DesktopModelSelection) => void;
  onContinueWithModel?: (selection: DesktopModelSelection) => Promise<boolean>;
  onRoutePreferenceApplied?: (selection: DesktopModelSelection, options?: { modelChoice?: boolean }) => void;
  /** Session readout seated right after the model trigger — the context
   *  gauge (user: 컨텍스트는 모델 선택기 옆). */
  modelAside?: ReactNode;
  queued?: unknown[];
  hiddenQueueIds?: Array<string | number>;
  pendingSubmissionIds?: Array<string | number>;
  onQueuedRestored?: (ids: string[]) => void;
  /** Rewindable user prompts (oldest → newest) for the Esc-Esc selector. */
  userMessages?: Array<{ id: string; text: string }>;
  submit: (content: DesktopPromptContent, options?: DesktopSubmitOptions) => Promise<unknown>;
  abort: (options?: DesktopAbortOptions) => Promise<unknown>;
  invokeResult: <T>(action: () => T | Promise<T>) => Promise<T | undefined>;
  applySnapshot: (snapshot: SessionSnapshot | null) => void;
  onNewTask: () => void;
  /** Session-pane /clear · /new: close this session's tab and open a New
   *  Task in its place with the session's settings inherited. */
  onClearToNewTask?: () => void;
  onResumeSession: (id: string) => void;
  onOpenSessions: () => void;
  onOpenProjects: () => void;
  onOpenSettings: (section?: SettingsSection | null) => void;
  onOpenCommandSurface: (surface: CommandSurfaceName) => void;
  /** /inherit carries this session into a new one in place. */
  onInherit?: () => Promise<boolean>;
  dropTargetRef: React.RefObject<HTMLElement | null>;
  /** This pane is the focused, visible one. A payload shared into the app from
   *  outside (share sheet) may only land in a composer the user can see. */
  paneActive?: boolean;
};

const ModelContinuationPreview = lazy(() => import('./ModelContinuationPreview'));
const WorkbenchTaskCenter = lazy(() => import('./WorkbenchTaskCenter'));

export const Composer = memo(function Composer(props: ComposerProps) {
  const {
    turnBusy,
    commandBusy,
    transitioning: parentTransitioning,
    focusRequest,
    historyScope,
    identityScope,
    recoveryScope,
    projectScope,
    sessionId,
    hasConversation,
    promptHistoryList,
    provider,
    model,
    effort,
    fast,
    fastCapable,
    modelParameters,
    contextPercent,
    draftMode,
    onDraftModelSelection,
    onRoutePreferenceApplied,
    modelAside,
    queued,
    hiddenQueueIds,
    pendingSubmissionIds,
    onQueuedRestored,
    userMessages,
    submit,
    abort,
    invokeResult,
    applySnapshot,
    onOpenSettings,
    dropTargetRef,
    paneActive = true,
  } = props;
  const [modelHandoffPending, setModelHandoffPending] = useState(false);
  const modelHandoffGuard = useRef(false);
  const [hydratedDraftScope, setHydratedDraftScope] = useState('');
  const [taskCenterOpen,setTaskCenterOpen]=useState(false);
  const [pendingModel,setPendingModel]=useState<{selection:DesktopModelSelection;resolve:(value:boolean)=>void}|null>(null);
  const pendingModelRef=useRef(pendingModel);pendingModelRef.current=pendingModel;
  useEffect(()=>()=>{pendingModelRef.current?.resolve(false);},[]);
  const transitioning = parentTransitioning || modelHandoffPending || hydratedDraftScope !== identityScope;
  const [draft, setDraft] = useState('');
  const [executionBudget, setExecutionBudget] = useState<ExecutionBudget>(() => readExecutionBudget(identityScope));
  const persistentDraftRef = useRef({ scope: identityScope, saved: { text: '', attachments: [] as ComposerAttachment[] } });
  const [submitting, setSubmitting] = useState(false);
  const [submissionRecoveryVersion, setSubmissionRecoveryVersion] = useState(0);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  // A failed transport acknowledgement may still have landed in the session.
  // Reuse the same id when the exact restored payload is retried so daemon-side
  // idempotency acknowledges it instead of posting a duplicate user message.
  const submissionRetryRef = useRef<{ key: string; id: string } | null>(null);
  const { showNotice: showComposerNotice, clearNotice } = useComposerNotice();
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [composerFocused, setComposerFocused] = useState(false);
  const activeIdentityScope = useRef(identityScope);
  const skillSelection = useComposerSkill(identityScope);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const paletteAnchor = useRef<HTMLFormElement>(null);
  const composingRef = useRef(false);
  const suppressImeLineBreakRef = useRef(false);
  // True while the current Shift hold has already produced a character ('?' is
  // Shift+/), so the Enter that follows is a send, not a newline chord.
  const shiftLatchRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const escapeClearAtRef = useRef(0);
  const composerPaintSamplePending = useRef(false);
  const transitioningRef = useRef(transitioning);
  transitioningRef.current = transitioning;
  // Voice → send in one press. The transcript reaches the draft through a
  // state update, and `send` reads the textarea, so the intent is parked here
  // and fired by the effect below on the commit that carries the words.
  const voiceSubmitPending = useRef(false);
  const dictation = useComposerDictation({
    transitioningRef,
    textarea,
    setDraft,
    invokeResult,
    showNotice: showComposerNotice,
    requestVoiceInstall: useCallback(() => onOpenSettings('voice'), [onOpenSettings]),
    onTranscriptSubmit: useCallback(() => {
      voiceSubmitPending.current = true;
    }, []),
  });
  const history = useComposerHistory({ historyScope, promptHistoryList });
  const {
    attachments,
    attachmentsRef,
    attachmentError,
    setAttachmentError,
    draggingFiles,
    setDraggingFiles,
    attachmentSequence,
    fileInput,
    insertAttachment,
    clearAttachments,
    removeAttachments,
    removeAttachment,
    updatePastedText,
    replaceAttachments,
    attachFiles,
    restoredAttachments,
    mergeRestoredAttachments,
    resetAttachments,
  } = useComposerAttachments({
    draftRef,
    setDraft,
    textarea,
    historyNavigation: history.navigation,
    transitioningRef,
    projectScope,
    recoveryScope,
    submissionRecoveryVersion,
    dropTargetRef,
  });
  // Attachment, slash-usage and submission failures surface as error toasts;
  // the state is consumed so the same failure can raise a toast again.
  useEffect(() => {
    if (!attachmentError) return;
    showComposerNotice(attachmentError, 'error');
    setAttachmentError('');
  }, [attachmentError, setAttachmentError, showComposerNotice]);
  useComposerExternalDraft({
    draftRef,
    setDraft,
    textarea,
    historyNavigation: history.navigation,
    attachFiles,
    shareActive: paneActive && !transitioning,
  });
  const { invokeCapabilityResult, invokeCapability } = useComposerCapability({
    invokeResult,
    applySnapshot,
    sessionId,
  });
  const queue = useComposerQueue({
    queued,
    hiddenQueueIds,
    pendingSubmissionIds,
    draftMode,
    turnBusy,
    draftRef,
    setDraft,
    textarea,
    composingRef,
    historyNavigation: history.navigation,
    invokeCapability,
    abort,
    restoredAttachments,
    mergeRestoredAttachments,
    showNotice: showComposerNotice,
    onQueuedRestored,
    scope: historyScope,
  });
  const selector = useComposerMessageSelector({
    userMessages,
    restoring: queue.restoring,
    setRestoring: queue.setRestoring,
    invokeCapability,
    setDraft,
    textarea,
    historyNavigation: history.navigation,
    showNotice: showComposerNotice,
  });
  const palettes = useComposerPalettes({
    draft,
    projectScope,
    paneActive,
    transitioning,
    composerFocused,
    selectorOpen: selector.open,
  });
  const { setCaretOffset, slash, mention } = palettes;
  useComposerIme({ textarea, composingRef, suppressImeLineBreakRef, draftRef, setDraft, setCaretOffset });
  // biome-ignore lint/correctness/useExhaustiveDependencies: must switch only when identityScope changes; the other captures are read at that moment and a re-run on their identity would reset the composer
  useLayoutEffect(() => {
    if (activeIdentityScope.current === identityScope) return;
    const previousScope = activeIdentityScope.current;
    activeIdentityScope.current = identityScope;
    switchComposerIdentity({
      identityScope,
      previousScope,
      textarea,
      draftRef,
      composingRef,
      suppressImeLineBreakRef,
      historyNavigation: history.navigation,
      resetAttachments,
      palettes,
      selector,
      setDraft,
      clearNotice,
      setComposerFocused,
      setDraggingFiles,
    });
  }, [identityScope, resetAttachments, clearNotice, palettes.reset, palettes.invalidateSearch, selector.reset]);
  // Hydrate after the scope reset, before accepting input. A model handoff
  // wins over disk recovery, and a late read can never write into another tab.
  useLayoutEffect(() => {
    let live = true;
    const restore = (saved: { text: string; attachments: typeof attachments } | undefined) => {
      if (!live) return;
      if (saved) {
        replaceAttachments(saved.attachments);
        attachmentSequence.current = Math.max(attachmentSequence.current, ...saved.attachments.map(item => item.id));
        draftRef.current = saved.text;
        setDraft(saved.text);
      }
      setHydratedDraftScope(identityScope);
    };
    const carried = takeComposerModelHandoff(sessionId || '');
    if (carried) restore(carried);
    else void readComposerDraft(identityScope).then(restore, () => {
      if (live) {
        setHydratedDraftScope(identityScope);
        showComposerNotice(t('Draft recovery is unavailable. Keep this window open until your message is sent.'), 'error');
      }
    });
    return () => { live = false; };
  }, [identityScope, sessionId, replaceAttachments, attachmentSequence, showComposerNotice]);

  useEffect(() => {
    if (hydratedDraftScope !== identityScope) return;
    const saved = { text: draft, attachments };
    persistentDraftRef.current = { scope: identityScope, saved };
    rememberComposerDraft(identityScope, saved);
    const timer = window.setTimeout(() => {
      void saveComposerDraft(identityScope, saved).catch(() => {
        showComposerNotice(t('Could not save the draft for recovery. Your input is still in this window.'), 'error');
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [draft, attachments, identityScope, hydratedDraftScope, showComposerNotice]);
  useEffect(() => {
    setExecutionBudget(readExecutionBudget(identityScope));
    const flush = () => {
      const pending = persistentDraftRef.current;
      if (pending.scope === identityScope) void saveComposerDraft(identityScope, pending.saved).catch(() => {});
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [identityScope]);

  useEffect(()=>{
    setTaskCenterOpen(false);
    if(!modelHandoffGuard.current || !modelHandoffPending){pendingModelRef.current?.resolve(false);setPendingModel(null);modelHandoffGuard.current=false;}
  },[identityScope]);
  const restoreWorkbenchDraft = async (saved: SavedComposerDraft) => {
    if(draftRef.current.trim() || attachmentsRef.current.length)
      await saveReplacedComposerDraft(identityScope,{text:draftRef.current,attachments:attachmentsRef.current});
    replaceAttachments(saved.attachments);draftRef.current=saved.text;setDraft(saved.text);
  };
  const openTaskCenter = () => {
    void saveComposerDraft(identityScope,{text:draftRef.current,attachments:attachmentsRef.current}).catch(()=>{});
    setTaskCenterOpen(true);
  };
  const openTaskCenterRef = useRef(openTaskCenter);
  openTaskCenterRef.current = openTaskCenter;
  // ⌘⇧K lives in the workbench shortcut table (capture phase, every surface);
  // the table dispatches OPEN_TASK_TOOLS_EVENT and the focused pane's
  // composer claims it with the same handler as the 도구 button.
  useEffect(()=>{
    if(!paneActive || !window.mixdogDesktop?.workbench)return;
    const handler=(event:Event)=>{if(event.defaultPrevented)return;event.preventDefault();openTaskCenterRef.current();};
    window.addEventListener(OPEN_TASK_TOOLS_EVENT,handler);return()=>window.removeEventListener(OPEN_TASK_TOOLS_EVENT,handler);
  },[paneActive]);

  // The draft travelled with the model handoff, so the source tab must not
  // hand it back again: drop its parked text, recovery row and live copy.
  const clearHandedOffDraft=(scope:string)=>{
    stashComposerDraft(scope,'');
    if(persistentDraftRef.current.scope===scope)persistentDraftRef.current={scope,saved:{text:'',attachments:[]}};
    if(mountedRef.current&&activeIdentityScope.current===scope){draftRef.current='';setDraft('');replaceAttachments([]);}
    void deleteComposerDraft(scope).catch(()=>{});
  };
  const cancelModelContinuation=()=>{pendingModel?.resolve(false);modelHandoffGuard.current=false;setPendingModel(null);};
  const continueWithModel = async (selection: DesktopModelSelection): Promise<boolean> => {
    if (!props.onContinueWithModel || !sessionId || modelHandoffGuard.current) return false;
    if (turnBusy || commandBusy || submittingRef.current || (queued?.length ?? 0) > 0 || parentTransitioning) {
      showComposerNotice(t('Finish or stop the current turn and clear queued messages before switching models.'), 'info');
      return false;
    }
    modelHandoffGuard.current=true;
    return new Promise(resolve=>setPendingModel({selection,resolve}));
  };
  const confirmModelContinuation=async():Promise<boolean>=>{
    if(!pendingModel||!props.onContinueWithModel||!sessionId)return false;
    transitioningRef.current=true;setModelHandoffPending(true);
    const sourceScope=identityScope;
    try {
      const ok=await withComposerModelHandoff(sessionId,{text:draftRef.current,attachments:attachmentsRef.current},()=>props.onContinueWithModel!(pendingModel.selection));
      if(ok){clearHandedOffDraft(sourceScope);pendingModel.resolve(true);modelHandoffGuard.current=false;if(mountedRef.current)setPendingModel(null);}
      return ok;
    }finally{if(mountedRef.current)setModelHandoffPending(false);}
  };

  const placeholder = composerPlaceholder({
    hasConversation,
    turnBusy,
    commandBusy,
    fallback: COMPOSER_PLACEHOLDERS[0],
  });
  // Autosize is CSS-native now (field-sizing: content). The old layout-effect
  // path forced TWO whole-document synchronous reflows per keystroke
  // (height:auto → scrollHeight read) — the measured source of typing lag on
  // long transcripts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setDraggingFiles identity is not guaranteed stable here; the effect must run only when transitioning changes
  useEffect(() => {
    if (!transitioning) return;
    setDraggingFiles(false);
  }, [transitioning]);
  useComposerFocus({ textarea, transitioning, focusRequest, paneActive });
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: identityScope and paneActive are reset triggers; the effect body does not read them
  useEffect(() => setGoalDialogOpen(false), [identityScope, paneActive]);
  const [editingPasteId, setEditingPasteId] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: identityScope and paneActive are reset triggers; the effect body does not read them
  useEffect(() => setEditingPasteId(null), [identityScope, paneActive]);
  const editingPaste = attachments.find((attachment) => attachment.id === editingPasteId);
  const executeSlash = createSlashExecutor({
    draftMode,
    sessionId,
    turnBusy,
    provider,
    model,
    effort,
    fast,
    fastCapable,
    modelParameters,
    ultrafastCapable: () =>
      modelOffersUltrafast(
        readCachedModelCatalog().models.find((entry) => entry.provider === provider && entry.model === model)
      ),
    onDraftModelSelection,
    onRoutePreferenceApplied,
    invokeResult,
    invokeCapabilityResult,
    applySnapshot,
    submit,
    setAttachmentError,
    clearNotice,
    showNotice: showComposerNotice,
    openGoalDialog: () => setGoalDialogOpen(true),
    onNewTask: props.onNewTask,
    onClearToNewTask: props.onClearToNewTask,
    onResumeSession: props.onResumeSession,
    onOpenSessions: props.onOpenSessions,
    onOpenProjects: props.onOpenProjects,
    onOpenSettings,
    onOpenCommandSurface: props.onOpenCommandSurface,
    onInherit: props.onInherit,
  });

  const { send, stop } = useComposerSubmission({
    turnBusy,
    commandBusy,
    draftMode,
    queued,
    recoveryScope,
    textarea,
    draftRef,
    attachmentsRef,
    transitioningRef,
    composingRef,
    submittingRef,
    submissionRetryRef,
    mountedRef,
    historyNavigation: history.navigation,
    setDraft,
    setSubmitting,
    setSubmissionRecoveryVersion,
    clearNotice,
    setAttachmentError,
    removeAttachments,
    mergeRestoredAttachments,
    restoredAttachments,
    executeSlash,
    rememberPrompt: history.rememberPrompt,
    submit: (content, options) => submit(content, { ...options, executionBudget }),
    abort,
    onQueuedRestored,
    selectedSkill: skillSelection.name,
    onSkillSubmitted: skillSelection.submitted,
  });
  const stopRequested=useRef(false);
  useEffect(()=>{if(stopRequested.current&&!turnBusy&&!commandBusy){stopRequested.current=false;showComposerNotice('현재 응답이 중지되었습니다. 이미 완료된 코드 변경은 유지됩니다. 백그라운드 실행은 실행 화면에서 확인하세요.','info');}},[turnBusy,commandBusy,showComposerNotice]);
  const stopWithFeedback=async()=>{if(stopRequested.current)return;stopRequested.current=true;showComposerNotice('중지 요청을 보내는 중입니다. 진행 중인 도구가 정리될 때까지 잠시 기다려 주세요.','info');try{await stop();}catch(error){stopRequested.current=false;showComposerNotice(error instanceof Error?error.message:String(error),'error');}};
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send('', 'form-submit');
  };
  const { selectMention, onKeyDown, onKeyUp } = useComposerKeyboard({
    draft: {
      value: draft,
      set: setDraft,
      ref: draftRef,
      textarea,
      setCaretOffset,
    },
    slash,
    mention,
    selector,
    history: {
      entries: history.entries,
      navigation: history.navigation,
      seedAttachments: history.seedAttachments,
      attachmentsRef,
      replaceAttachments,
    },
    queue: {
      pendingSubmissionId: queue.pendingSubmissionId,
      hasRestorableMessages: queue.hasRestorableQueuedMessages,
      restore: (source) => {
        void queue.restoreQueue('', source);
      },
    },
    runtime: {
      turnBusy,
      draftMode,
      attachments,
      escapeClearAt: escapeClearAtRef,
      showNotice: showComposerNotice,
    },
    ime: {
      composing: composingRef,
      suppressLineBreak: suppressImeLineBreakRef,
      shiftLatch: shiftLatchRef,
    },
    actions: {
      send,
      stop,
      clearAttachments,
    },
  });
  const stopOnly = shouldStopComposerGeneration({
    turnBusy,
    text: draft,
    attachments,
  });
  // A live take turns the send disc into "finish and send"; a running turn
  // still claims that disc for Stop.
  const voiceSend = !stopOnly && dictation.dictationState === 'recording';
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft is a re-check trigger for the pending voice submit even though the body does not read it
  useEffect(() => {
    if (!voiceSubmitPending.current || dictation.dictationState !== 'idle') return;
    voiceSubmitPending.current = false;
    void send('', 'voice-submit');
  }, [dictation.dictationState, draft, send]);

  const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    sampleKeystrokePaint(composerPaintSamplePending);
    const value = event.currentTarget.value;
    draftRef.current = value;
    setDraft(value);
    escapeClearAtRef.current = 0;
    clearNotice();
    setCaretOffset(event.currentTarget.selectionStart);
    if (slash.dismissed) slash.setDismissed('');
    if (mention.dismissed) mention.setDismissed('');
    history.navigation.current = { index: -1, seed: '' };
  };
  const onTextareaBlur = () => {
    composingRef.current = false;
    suppressImeLineBreakRef.current = false;
    shiftLatchRef.current = false;
    setComposerFocused(false);
  };
  const onTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const removeSkill = shouldRemoveSelectedSkill({
      selected: skillSelection.name,
      key: event.key,
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd,
      composing: composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229,
      repeat: event.repeat,
      modified: event.ctrlKey || event.metaKey || event.altKey,
    });
    if (removeSkill) {
      event.preventDefault();
      event.stopPropagation();
      skillSelection.select('');
      return;
    }
    onKeyDown(event);
  };
  const onTextareaPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    handleComposerPaste(event, { attachFiles, attachmentSequence, insertAttachment });
  };
  const focusTextareaFromForm = (event: React.MouseEvent<HTMLFormElement>) => {
    if (touchPrimaryPointer()) return;
    const target = event.target as HTMLElement;
    if (!target.closest('button, input, textarea, [role="listbox"]')) textarea.current?.focus();
  };
  const goalDisabled = turnBusy || commandBusy || submitting;
  return (
    <>
      <QueueList
        queued={queue.visibleQueued}
        restoring={queue.restoring}
        onEdit={(id) => void queue.restoreQueue(id, 'queue-row')}
        onSteer={(id) => void queue.steerQueuedNow(id)}
        onRemove={(id) => void queue.discardQueued(id)}
      />
      <ComposerBanners draggingFiles={draggingFiles} transitioning={transitioning} dropTarget={dropTargetRef.current} />
      <form
        ref={paletteAnchor}
        className="composer"
        onSubmit={onSubmit}
        data-composer-palette-open={selector.open || slash.open || mention.open ? 'true' : undefined}
        aria-busy={transitioning}
        onMouseDown={focusTextareaFromForm}
      >
        {selector.open && (
          <MessageSelectorPalette
            anchor={paletteAnchor}
            panel={selector.palette}
            messages={selector.messages}
            index={selector.index}
            setIndex={selector.setIndex}
            onSelect={(id) => void selector.rewindToMessage(id)}
          />
        )}
        {slash.open && (
          <SlashPalette
            anchor={paletteAnchor}
            panel={slash.palette}
            commands={slash.commands}
            index={slash.index}
            setIndex={slash.setIndex}
            onSelect={(usage) => void send(usage)}
          />
        )}
        {mention.open && (
          <MentionPalette
            anchor={paletteAnchor}
            panel={mention.palette}
            results={mention.results}
            loading={mention.loading}
            index={mention.index}
            setIndex={mention.setIndex}
            onSelect={selectMention}
          />
        )}
        {attachments.length > 0 && (
          <AttachmentChips
            attachments={attachments}
            onRemove={removeAttachment}
            onEdit={(attachment) => setEditingPasteId(attachment.id)}
            onError={setAttachmentError}
          />
        )}
        {editingPaste && (
          <ComposerPastedTextDialog
            anchor={textarea}
            text={editingPaste.data}
            onSave={(text) => updatePastedText(editingPaste, text)}
            onClose={() => setEditingPasteId(null)}
            returnFocus={() => textarea.current?.focus()}
          />
        )}
        {dictation.dictationState !== 'idle' && (
          <DictationOverlay
            state={dictation.dictationState}
            levelRef={dictation.dictationLevelRef}
            elapsedMs={dictation.recordingElapsedMs}
            onCancel={() => dictation.cancelDictation()}
          />
        )}
        <div className="composer-input-row">
          {skillSelection.name && (
            <span className="composer-selected-skill">
              <button type="button" onClick={() => textarea.current?.focus()} title={skillSelection.name}>
                <CapabilityIcon name={skillSelection.name} />
                <span>{skillTitle(skillSelection.name)}</span>
              </button>
            </span>
          )}
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the textarea drives the slash/mention popup and reports whether it is open */}
          <textarea
            ref={textarea}
            value={draft}
            onChange={onTextareaChange}
            onFocus={() => setComposerFocused(true)}
            onBlur={onTextareaBlur}
            onPointerDown={() => {
              escapeClearAtRef.current = 0;
            }}
            onSelect={(event) => setCaretOffset(event.currentTarget.selectionStart)}
            onKeyDown={onTextareaKeyDown}
            onKeyUp={onKeyUp}
            onPaste={onTextareaPaste}
            rows={1}
            placeholder={placeholder}
            disabled={transitioning}
            aria-controls={palettes.paletteId}
            aria-expanded={slash.open || mention.open}
            aria-activedescendant={palettes.activeDescendant}
            aria-label={t('Message COSMOS')}
          />
        </div>
        <ComposerFooter
          attachAccept={ATTACHMENT_ACCEPT}
          fileInput={fileInput}
          onFilesChosen={(files) => void attachFiles(files)}
          textarea={textarea}
          paletteAnchor={paletteAnchor}
          recoveryScope={recoveryScope}
          goalDialogOpen={goalDialogOpen}
          setGoalDialogOpen={setGoalDialogOpen}
          goalDisabled={goalDisabled}
          executeSlash={executeSlash}
          transitioning={transitioning}
          commandBusy={commandBusy}
          turnBusy={turnBusy}
          paneActive={paneActive}
          hasConversation={hasConversation}
          submitting={submitting}
          skillSelection={skillSelection}
          mention={mention}
          dictation={dictation}
          stopOnly={stopOnly}
          voiceSend={voiceSend}
          draft={draft}
          attachments={attachments}
          onStop={() => void stopWithFeedback()}
          onOpenTaskCenter={window.mixdogDesktop?.workbench ? openTaskCenter : undefined}
          executionBudget={executionBudget}
          onExecutionBudgetChange={(value) => { setExecutionBudget(value); saveExecutionBudget(identityScope, value); }}
          modelAside={modelAside}
          provider={provider}
          model={model}
          effort={effort}
          fast={fast}
          fastCapable={fastCapable}
          modelParameters={modelParameters}
          contextPercent={contextPercent}
          sessionId={sessionId}
          invokeResult={invokeResult}
          applySnapshot={applySnapshot}
          onOpenSettings={onOpenSettings}
          onDraftModelSelection={onDraftModelSelection}
          onContinueWithModel={props.onContinueWithModel ? continueWithModel : undefined}
          onRoutePreferenceApplied={onRoutePreferenceApplied}
        />
      </form>
      {pendingModel && <Suspense fallback={null}><ModelContinuationPreview anchor={paletteAnchor} sessionId={sessionId||''} sourceModel={model} target={pendingModel.selection} attachmentCount={attachments.length} onCancel={cancelModelContinuation} onContinue={confirmModelContinuation}/></Suspense>}
      {taskCenterOpen && <Suspense fallback={<span role="status" className="workbench-opening">작업 도구를 여는 중…</span>}>
        <WorkbenchTaskCenter anchor={paletteAnchor} projectPath={projectScope} sessionId={sessionId||''} scope={identityScope}
          draft={draft} attachments={attachments} provider={provider} model={model} turnBusy={turnBusy||commandBusy}
          onClose={()=>setTaskCenterOpen(false)} onRestoreDraft={restoreWorkbenchDraft} onRemoveAttachment={id=>{const item=attachmentsRef.current.find(item=>item.id===id);if(item)removeAttachment(item);}}
          onResumeSession={props.onResumeSession} onOpenProjects={props.onOpenProjects} onOpenSettings={props.onOpenSettings}/>
      </Suspense>}
    </>
  );
});

export { ModelSelector, WorkflowSelect, OrchestrationModeSelect } from './model-controls';
