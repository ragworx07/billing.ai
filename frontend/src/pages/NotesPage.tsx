import type { ChangeEvent, CSSProperties, DragEvent, FormEvent, KeyboardEvent, PointerEvent } from 'react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import clsx from 'clsx';
import {
  Archive,
  ArrowDownAZ,
  ArrowUpAZ,
  Clock3,
  Download,
  FileText,
  GripVertical,
  NotebookPen,
  Paperclip,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { getApiErrorMessage } from '../utils/errors';

type NotePriority = 'urgent' | 'high' | 'medium' | 'low';
type SortMode = 'my_order' | 'priority' | 'latest' | 'oldest';

type NoteAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  storageBucket?: string | null;
  storagePath?: string | null;
};

type NoteRecord = {
  id: string;
  order: number;
  x: number;
  y: number;
  topic: string;
  importantInfo: string;
  reminderWhen: string;
  details: string;
  createdAt: string;
  updatedAt: string;
  reminderLabel: string;
  color: string;
  priority: NotePriority;
  attachments: NoteAttachment[];
  archivedAt?: string | null;
};

type NoteDraft = {
  topic: string;
  importantInfo: string;
  reminderWhen: string;
  details: string;
  reminderLabel: string;
  color: string;
  priority: NotePriority;
  attachments: NoteAttachment[];
};

type StoredNotes = {
  active: NoteRecord[];
  archived: NoteRecord[];
};

type AttachmentViewerState = {
  attachment: NoteAttachment;
  noteTitle: string;
};

type PendingActionState = {
  noteId: string;
  action: 'archive' | 'delete';
};

type AttachmentRemovalSnapshot = {
  source: 'composer' | 'selected';
  noteId?: string;
  details: string;
  attachments: NoteAttachment[];
};

type TauriInternals = {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals;
};

const priorityOrder: Record<NotePriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const priorityPillClasses: Record<NotePriority, string> = {
  urgent: 'bg-rose-200 text-rose-800',
  high: 'bg-amber-200 text-amber-800',
  medium: 'bg-sky-100 text-sky-800',
  low: 'bg-emerald-100 text-emerald-800',
};

const noteColors = [
  { value: 'amber', card: 'bg-amber-100', edge: 'border-amber-300', accent: 'bg-amber-500', panel: 'bg-amber-50', panelBorder: 'border-amber-200' },
  { value: 'mint', card: 'bg-emerald-100', edge: 'border-emerald-300', accent: 'bg-emerald-600', panel: 'bg-emerald-50', panelBorder: 'border-emerald-200' },
  { value: 'sky', card: 'bg-sky-100', edge: 'border-sky-300', accent: 'bg-sky-600', panel: 'bg-sky-50', panelBorder: 'border-sky-200' },
  { value: 'rose', card: 'bg-rose-100', edge: 'border-rose-300', accent: 'bg-rose-500', panel: 'bg-rose-50', panelBorder: 'border-rose-200' },
] as const;

const initialDraft: NoteDraft = {
  topic: '',
  importantInfo: '',
  reminderWhen: '',
  details: '',
  reminderLabel: '',
  color: noteColors[0].value,
  priority: 'medium',
  attachments: [],
};

function getNotesStorageKey(userId?: number | string | null) {
  return userId ? `cido_notes_board_u${userId}_v1` : 'cido_notes_board_guest_v1';
}

function isEmptyBoard(board: StoredNotes) {
  return board.active.length === 0 && board.archived.length === 0;
}

function readStoredNotesBoard(userId?: number | string | null): StoredNotes | null {
  try {
    const key = getNotesStorageKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNotes;
    if (!Array.isArray(parsed.active) || !Array.isArray(parsed.archived)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredNotesBoard(board: StoredNotes, userId?: number | string | null) {
  const key = getNotesStorageKey(userId);
  localStorage.setItem(key, JSON.stringify(board));
}

function getColorConfig(color: string) {
  return noteColors.find((item) => item.value === color) || noteColors[0];
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToDocumentHtml(value: string) {
  const normalized = value.trim();
  if (!normalized) return '<p><br></p>';
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function normalizeDocumentHtml(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '<p><br></p>';
  if (trimmed.includes('<') && trimmed.includes('>')) return trimmed;
  return textToDocumentHtml(trimmed);
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatReminderWhen(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.trim();
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDatetimeLocalValue(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function getTagRecommendations(draft: NoteDraft) {
  const searchText = [draft.topic, draft.details, draft.reminderWhen, draft.importantInfo, draft.reminderLabel]
    .join(' ')
    .toLowerCase();

  const recommendationRules = [
    { tag: 'Client Follow-up', terms: ['follow up', 'follow-up', 'callback', 'client call'] },
    { tag: 'Payment', terms: ['payment', 'invoice', 'bill', 'billing', 'receipt', 'collection', 'due'] },
    { tag: 'Site Visit', terms: ['site visit', 'site', 'inspection', 'walkthrough', 'visit'] },
    { tag: 'Material', terms: ['material', 'cement', 'steel', 'sand', 'aggregate', 'supply'] },
    { tag: 'Labour', terms: ['labour', 'labor', 'worker', 'staff', 'mason', 'carpenter'] },
    { tag: 'Meeting', terms: ['meeting', 'review', 'discussion', 'sync'] },
    { tag: 'Urgent', terms: ['urgent', 'asap', 'today', 'immediately', 'critical'] },
    { tag: 'Reminder', terms: ['reminder', 'schedule', 'deadline', 'alert', 'remember'] },
    { tag: 'Approval', terms: ['approve', 'approval', 'sign off', 'sign-off', 'permission'] },
    { tag: 'Delivery', terms: ['delivery', 'dispatch', 'shipment', 'transport'] },
  ];

  const suggestions: string[] = [];
  recommendationRules.forEach((rule) => {
    if (rule.terms.some((term) => searchText.includes(term))) {
      suggestions.push(rule.tag);
    }
  });

  if (!suggestions.length && draft.topic.trim()) {
    suggestions.push(draft.topic.trim().split(/\s+/).slice(0, 2).join(' '));
  }

  suggestions.push(draft.priority === 'urgent' ? 'Urgent' : draft.priority === 'high' ? 'Important' : 'General');

  return Array.from(new Set(suggestions)).slice(0, 4);
}

function createAttachmentFrameHtml(attachment: NoteAttachment) {
  const title = escapeHtml(attachment.name);
  const size = escapeHtml(formatAttachmentSize(attachment.size));
  if (attachment.type.startsWith('image/')) {
    return `<figure class="note-inline-attachment note-inline-attachment-image" contenteditable="false" data-attachment-id="${escapeHtml(attachment.id)}" data-attachment-name="${title}" data-attachment-type="${escapeHtml(attachment.type)}"><button type="button" class="note-inline-attachment-remove" data-attachment-remove="${escapeHtml(attachment.id)}" aria-label="Remove ${title}">×</button><img src="${attachment.dataUrl}" alt="${title}" class="note-inline-attachment-image-surface" data-inline-image="true" draggable="false" /><figcaption class="note-inline-attachment-caption" contenteditable="false"><span>${title}</span><span>${size}</span></figcaption></figure><p><br></p>`;
  }
  return `<figure class="note-inline-attachment note-inline-attachment-file" contenteditable="false" data-attachment-id="${escapeHtml(attachment.id)}" data-attachment-name="${title}" data-attachment-type="${escapeHtml(attachment.type)}"><button type="button" class="note-inline-attachment-remove" data-attachment-remove="${escapeHtml(attachment.id)}" aria-label="Remove ${title}">×</button><div class="note-inline-attachment-file-row" contenteditable="false"><span class="note-inline-attachment-icon">📎</span><div class="note-inline-attachment-meta"><span class="note-inline-attachment-name">${title}</span><span class="note-inline-attachment-size">${size}</span></div></div></figure><p><br></p>`;
}

function getNoteBodyHtml(details: string, attachments: NoteAttachment[]) {
  const normalized = stripAttachmentFramesFromHtml(details);
  if (attachments.length === 0) return normalized;
  return `${normalized}${attachments.map(createAttachmentFrameHtml).join('')}`;
}

function removeAttachmentFrameHtml(details: string, attachmentId: string) {
  if (typeof DOMParser === 'undefined') {
    return details;
  }
  const parser = new DOMParser();
  const documentRoot = parser.parseFromString(`<div id="note-root">${normalizeDocumentHtml(details)}</div>`, 'text/html');
  const frame = documentRoot.querySelector(`[data-attachment-id="${attachmentId}"]`);
  frame?.remove();
  const nextHtml = documentRoot.querySelector('#note-root')?.innerHTML?.trim() ?? '';
  return nextHtml || '<p><br></p>';
}

function stripAttachmentFramesFromHtml(details: string) {
  if (typeof DOMParser === 'undefined') {
    return details;
  }
  const parser = new DOMParser();
  const documentRoot = parser.parseFromString(`<div id="note-root">${normalizeDocumentHtml(details)}</div>`, 'text/html');
  documentRoot.querySelectorAll('[data-attachment-id]').forEach((frame) => frame.remove());
  return documentRoot.querySelector('#note-root')?.innerHTML?.trim() || '<p><br></p>';
}

function getDefaultBoardPosition(index: number) {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: 24 + column * 296 + ((index * 17) % 18),
    y: 24 + row * 236 + ((index * 11) % 16),
  };
}

function formatNoteTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isTauriRuntime() {
  return Boolean((window as TauriWindow).__TAURI_INTERNALS__?.invoke);
}

function tauriInvoke<T>(command: string, args?: Record<string, unknown>) {
  const invoke = (window as TauriWindow).__TAURI_INTERNALS__?.invoke;
  if (!invoke) return null;
  return invoke<T>(command, args);
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
}

async function readTauriClipboardImageFile() {
  const imageDataUrl = await tauriInvoke<string | null>('read_clipboard_image_png');
  if (!imageDataUrl) return null;
  return dataUrlToFile(imageDataUrl, `snip-${Date.now()}.png`);
}

function sanitizeClipboardHtml(value: string) {
  return value.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').trim();
}

function plainTextToClipboardHtml(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

export function NotesPage() {
  const { user } = useAuth();
  const boardRef = useRef<HTMLDivElement | null>(null);
  const archiveDropRef = useRef<HTMLButtonElement | null>(null);
  const deleteDropRef = useRef<HTMLButtonElement | null>(null);
  const dropRailRef = useRef<HTMLDivElement | null>(null);
  const composerEditorRef = useRef<HTMLDivElement | null>(null);
  const selectedEditorRef = useRef<HTMLDivElement | null>(null);
  const [notesState, setNotesState] = useState<StoredNotes>({ active: [], archived: [] });
  const [draft, setDraft] = useState<NoteDraft>(initialDraft);
  const [query, setQuery] = useState('');
  const [boardMode, setBoardMode] = useState<'active' | 'archived'>('active');
  const [sortMode, setSortMode] = useState<SortMode>('my_order');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<'archive' | 'delete' | null>(null);
  const [saveError, setSaveError] = useState('');
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [viewer, setViewer] = useState<AttachmentViewerState | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null);
  const [selectedEditorHtml, setSelectedEditorHtml] = useState('<p><br></p>');
  const deferredQuery = useDeferredValue(query);
  const notesStateRef = useRef<StoredNotes>({ active: [], archived: [] });
  const pendingNotesBoardRef = useRef<StoredNotes | null>(null);
  const saveInFlightRef = useRef(false);
  const saveRetryAttemptRef = useRef(0);
  const saveRetryTimerRef = useRef<number | null>(null);
  const attachmentUndoRef = useRef<AttachmentRemovalSnapshot | null>(null);
  const pointerDragRef = useRef<{
    noteId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextNoteClickRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function loadBoard() {
      if (!user?.id) return;

      // Reset state for new user
      const emptyBoard = { active: [], archived: [] };
      notesStateRef.current = emptyBoard;
      setNotesState(emptyBoard);
      setSelectedNoteId(null);
      setEditingNoteId(null);

      const localBoard = readStoredNotesBoard(user.id);
      if (localBoard && !cancelled) {
        notesStateRef.current = localBoard;
        setNotesState(localBoard);
      }

      try {
        const board = await api.getNotesBoard();
        if (!cancelled) {
          notesStateRef.current = board;
          setNotesState(board);
          writeStoredNotesBoard(board, user.id);
          setSaveError('');
        }
      } catch {
        if (!cancelled) {
          setSaveError(localBoard ? 'Showing locally saved notes until the API is available.' : 'Notes could not load from the API.');
        }
      }
    }

    void loadBoard();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!user?.id) return;
      const pendingBoard = pendingNotesBoardRef.current;
      if (pendingBoard) {
        writeStoredNotesBoard(pendingBoard, user.id);
      } else {
        writeStoredNotesBoard(notesState, user.id);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [notesState, user?.id]);

  function scheduleNotesRetry() {
    if (saveRetryTimerRef.current !== null) return;
    const delay = Math.min(30_000, 2_000 * (2 ** Math.max(0, saveRetryAttemptRef.current - 1)));
    saveRetryTimerRef.current = window.setTimeout(() => {
      saveRetryTimerRef.current = null;
      void flushNotesBoard();
    }, delay);
  }

  async function flushNotesBoard() {
    if (saveInFlightRef.current || saveRetryTimerRef.current !== null) return;
    const nextBoard = pendingNotesBoardRef.current;
    if (!nextBoard) return;

    saveInFlightRef.current = true;
    pendingNotesBoardRef.current = null;
    let saved = false;

    try {
      await api.saveNotesBoard(nextBoard);
      writeStoredNotesBoard(nextBoard, user?.id);
      saveRetryAttemptRef.current = 0;
      setSaveError('');
      saved = true;
    } catch (error) {
      if (!pendingNotesBoardRef.current) {
        pendingNotesBoardRef.current = nextBoard;
      }
      writeStoredNotesBoard(nextBoard, user?.id);
      saveRetryAttemptRef.current += 1;
      setSaveError(`${getApiErrorMessage(error, 'Notes could not save to the server.')} Local changes are preserved and will retry.`);
    } finally {
      saveInFlightRef.current = false;
      if (pendingNotesBoardRef.current) {
        if (saved) {
          void flushNotesBoard();
        } else {
          scheduleNotesRetry();
        }
      }
    }
  }

  useEffect(() => () => {
    if (saveRetryTimerRef.current !== null) {
      window.clearTimeout(saveRetryTimerRef.current);
    }
  }, []);

  function applyNotesUpdate(update: (current: StoredNotes) => StoredNotes) {
    const nextBoard = update(notesStateRef.current);
    notesStateRef.current = nextBoard;
    setNotesState(nextBoard);
    writeStoredNotesBoard(nextBoard, user?.id);
    pendingNotesBoardRef.current = nextBoard;
    void flushNotesBoard();
  }

  const visibleNotes = boardMode === 'active' ? notesState.active : notesState.archived;
  const filteredNotes = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    let rows = visibleNotes;
    if (normalizedQuery) {
      rows = rows.filter((note) =>
        [note.topic, note.importantInfo, note.reminderWhen, note.details, note.reminderLabel, note.priority]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
      );
    }

    return [...rows].sort((left, right) => {
      if (sortMode === 'my_order') return left.order - right.order;
      if (sortMode === 'latest') return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (sortMode === 'oldest') return new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
      const priorityGap = priorityOrder[right.priority] - priorityOrder[left.priority];
      if (priorityGap !== 0) return priorityGap;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [deferredQuery, visibleNotes, sortMode]);

  const selectedNote = useMemo(
    () =>
      notesState.active.find((note) => note.id === selectedNoteId) ||
      notesState.archived.find((note) => note.id === selectedNoteId) ||
      null,
    [notesState, selectedNoteId],
  );

  const activeCount = notesState.active.length;
  const archivedCount = notesState.archived.length;
  const urgentCount = notesState.active.filter((note) => note.priority === 'urgent').length;
  const attachmentCount = notesState.active.reduce((sum, note) => sum + note.attachments.length, 0);
  const composerColor = getColorConfig(draft.color);
  const boardHeight = useMemo(() => {
    if (sortMode !== 'my_order') return 0;
    const maxY = filteredNotes.reduce((highest, note) => Math.max(highest, note.y), 0);
    return Math.max(window.innerHeight ? window.innerHeight - 280 : 720, maxY + 320);
  }, [filteredNotes, sortMode]);

  async function addFiles(files: FileList | File[] | null, target: 'composer' | 'selected' = 'composer') {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    const oversizedFile = selectedFiles.find((file) => file.size > 6 * 1024 * 1024);
    if (oversizedFile) {
      setSaveError(`${oversizedFile.name} is larger than the 6 MB attachment limit.`);
      return;
    }

    setIsUploadingAttachment(true);
    let attachments: NoteAttachment[];
    try {
      attachments = await Promise.all(selectedFiles.map((file) => api.uploadNoteAttachment(file)));
      setSaveError('');
    } catch (error) {
      setSaveError(getApiErrorMessage(error, 'Attachment could not upload. Please try again.'));
      return;
    } finally {
      setIsUploadingAttachment(false);
    }
    const nextHtml = attachments.map(createAttachmentFrameHtml).join('');
    if (target === 'composer') {
      if (composerEditorRef.current) {
        composerEditorRef.current.insertAdjacentHTML('beforeend', nextHtml);
      }
      setDraft((current) => ({
        ...current,
        details: composerEditorRef.current?.innerHTML ?? `${current.details}${nextHtml}`,
        attachments: [...current.attachments, ...attachments],
      }));
      return;
    }
    if (selectedEditorRef.current) {
      selectedEditorRef.current.insertAdjacentHTML('beforeend', nextHtml);
    }
    setSelectedEditorHtml((current) => selectedEditorRef.current?.innerHTML ?? `${current}${nextHtml}`);
    if (!selectedNote) return;
    applyNotesUpdate((current) => {
      const updateRows = (rows: NoteRecord[]) =>
        rows.map((note) =>
          note.id === selectedNote.id
            ? {
                ...note,
                attachments: [...note.attachments, ...attachments],
                updatedAt: new Date().toISOString(),
              }
            : note,
        );
      const nextBoard = {
        active: updateRows(current.active),
        archived: updateRows(current.archived),
      };
      return nextBoard;
    });
  }

  function restoreAttachmentSnapshot(snapshot: AttachmentRemovalSnapshot) {
    attachmentUndoRef.current = null;
    if (snapshot.source === 'composer') {
      setDraft((current) => ({
        ...current,
        details: snapshot.details,
        attachments: snapshot.attachments,
      }));
      window.setTimeout(() => {
        if (composerEditorRef.current) {
          composerEditorRef.current.innerHTML = normalizeDocumentHtml(snapshot.details);
        }
      }, 0);
      return;
    }

    if (!snapshot.noteId) return;
    applyNotesUpdate((current) => {
      const updateRows = (rows: NoteRecord[]) =>
        rows.map((note) =>
          note.id === snapshot.noteId
              ? {
                ...note,
                details: stripAttachmentFramesFromHtml(snapshot.details),
                attachments: snapshot.attachments,
                updatedAt: new Date().toISOString(),
              }
            : note,
        );
      return {
        active: updateRows(current.active),
        archived: updateRows(current.archived),
      };
    });
    window.setTimeout(() => {
      if (selectedEditorRef.current && selectedNoteId === snapshot.noteId) {
        selectedEditorRef.current.innerHTML = normalizeDocumentHtml(snapshot.details);
      }
      setSelectedEditorHtml(normalizeDocumentHtml(snapshot.details));
    }, 0);
  }

  function removeAttachmentFromEditor(source: 'composer' | 'selected', attachmentId: string) {
    if (source === 'composer') {
      const snapshot: AttachmentRemovalSnapshot = {
        source,
        details: draft.details,
        attachments: draft.attachments,
      };
      attachmentUndoRef.current = snapshot;
      const nextAttachments = draft.attachments.filter((attachment) => attachment.id !== attachmentId);
      const nextDetails = removeAttachmentFrameHtml(composerEditorRef.current?.innerHTML ?? draft.details, attachmentId);
      setDraft((current) => ({
        ...current,
        details: nextDetails,
        attachments: nextAttachments,
      }));
      if (composerEditorRef.current) {
        composerEditorRef.current.innerHTML = normalizeDocumentHtml(nextDetails);
      }
      return;
    }

    if (!selectedNote) return;
    const snapshot: AttachmentRemovalSnapshot = {
      source,
      noteId: selectedNote.id,
      details: selectedEditorHtml,
      attachments: selectedNote.attachments,
    };
    attachmentUndoRef.current = snapshot;
    const nextAttachments = selectedNote.attachments.filter((attachment) => attachment.id !== attachmentId);
    const nextDetails = removeAttachmentFrameHtml(selectedEditorRef.current?.innerHTML ?? selectedEditorHtml, attachmentId);
    setSelectedEditorHtml(nextDetails);
    if (selectedEditorRef.current) {
      selectedEditorRef.current.innerHTML = normalizeDocumentHtml(nextDetails);
    }
    applyNotesUpdate((current) => {
      const updateRows = (rows: NoteRecord[]) =>
        rows.map((note) =>
          note.id === selectedNote.id
            ? {
                ...note,
                details: stripAttachmentFramesFromHtml(nextDetails),
                attachments: nextAttachments,
                updatedAt: new Date().toISOString(),
              }
            : note,
        );
      return {
        active: updateRows(current.active),
        archived: updateRows(current.archived),
      };
    });
  }

  async function handleAttachmentInput(event: ChangeEvent<HTMLInputElement>) {
    await addFiles(event.target.files, 'composer');
    event.target.value = '';
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>, target: 'composer' | 'selected') {
    const clipboardFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const clipboardHtml = sanitizeClipboardHtml(event.clipboardData.getData('text/html'));
    const clipboardText = event.clipboardData.getData('text/plain');

    if (clipboardFiles.length) {
      event.preventDefault();
      await addFiles(clipboardFiles, target);
      return;
    }

    if (!isTauriRuntime()) {
      return;
    }

    event.preventDefault();

    const clipboardImage = await readTauriClipboardImageFile();
    if (clipboardImage) {
      await addFiles([clipboardImage], target);
      return;
    }

    const htmlToInsert = clipboardHtml || (clipboardText ? plainTextToClipboardHtml(clipboardText) : '');
    if (htmlToInsert) {
      document.execCommand('insertHTML', false, htmlToInsert);
      syncEditorContentAfterPaste(target);
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>, target: 'composer' | 'selected') {
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (!droppedFiles.length) return;
    event.preventDefault();
    await addFiles(droppedFiles, target);
  }

  function openComposer(note?: NoteRecord) {
    if (note) {
      setEditingNoteId(note.id);
      setDraft({
        topic: note.topic,
        importantInfo: note.importantInfo || note.reminderWhen,
        reminderWhen: note.reminderWhen || note.importantInfo,
        details: getNoteBodyHtml(note.details, note.attachments),
        reminderLabel: note.reminderLabel,
        color: note.color,
        priority: note.priority,
        attachments: note.attachments,
      });
      setShowReminderPicker(Boolean(note.reminderWhen));
    } else {
      setEditingNoteId(null);
      setDraft(initialDraft);
      setShowReminderPicker(false);
    }
    setIsComposerOpen(true);
  }

  function closeComposer() {
    setIsComposerOpen(false);
    setEditingNoteId(null);
    setDraft(initialDraft);
    setShowReminderPicker(false);
  }

  function syncComposerDetailsFromDom() {
    if (!composerEditorRef.current) return;
    setDraft((current) => ({
      ...current,
      details: composerEditorRef.current?.innerHTML ?? current.details,
    }));
  }

  function syncSelectedEditorFromDom() {
    if (!selectedEditorRef.current) return;
    setSelectedEditorHtml(selectedEditorRef.current.innerHTML);
  }

  function syncEditorContentAfterPaste(target: 'composer' | 'selected') {
    window.setTimeout(() => {
      if (target === 'composer') {
        syncComposerDetailsFromDom();
      } else {
        syncSelectedEditorFromDom();
      }
    }, 0);
  }

  function handleAttachmentUndoKeyDown(event: KeyboardEvent<HTMLDivElement>, source: 'composer' | 'selected') {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
    const snapshot = attachmentUndoRef.current;
    if (!snapshot || snapshot.source !== source) return;
    event.preventDefault();
    restoreAttachmentSnapshot(snapshot);
  }

  useEffect(() => {
    if (composerEditorRef.current && isComposerOpen) {
      const nextHtml = normalizeDocumentHtml(draft.details);
      if (composerEditorRef.current.innerHTML !== nextHtml) {
        composerEditorRef.current.innerHTML = nextHtml;
      }
    }
  }, [editingNoteId, isComposerOpen]);

  useEffect(() => {
    if (!selectedNote) return;
    setSelectedEditorHtml(getNoteBodyHtml(selectedNote.details, selectedNote.attachments));
  }, [selectedNote]);

  useEffect(() => {
    if (selectedEditorRef.current && selectedNote) {
      const nextHtml = normalizeDocumentHtml(selectedEditorHtml);
      if (selectedEditorRef.current.innerHTML !== nextHtml) {
        selectedEditorRef.current.innerHTML = nextHtml;
      }
    }
  }, [selectedEditorHtml, selectedNote]);

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.topic.trim()) return;
    const timestamp = new Date().toISOString();
    const reminderWhen = draft.reminderWhen.trim();
    const noteDetails = stripAttachmentFramesFromHtml(composerEditorRef.current?.innerHTML ?? draft.details);

    if (editingNoteId) {
      applyNotesUpdate((current) => {
        const updateRows = (rows: NoteRecord[]) =>
          rows.map((note) =>
            note.id === editingNoteId
              ? {
                  ...note,
                  topic: draft.topic.trim(),
                  importantInfo: reminderWhen,
                  reminderWhen,
                  details: noteDetails,
                  reminderLabel: draft.reminderLabel.trim(),
                  color: draft.color,
                  priority: draft.priority,
                  attachments: draft.attachments,
                  updatedAt: timestamp,
                }
              : note,
          );
        const nextBoard = {
          active: updateRows(current.active),
          archived: updateRows(current.archived),
        };
        return nextBoard;
      });
      setSelectedNoteId(editingNoteId);
      closeComposer();
      return;
    }

    const note: NoteRecord = {
      id: createId('note'),
      order: notesState.active.length ? Math.max(...notesState.active.map((item) => item.order)) + 1 : 1,
      ...getDefaultBoardPosition(notesState.active.length),
      topic: draft.topic.trim(),
      importantInfo: reminderWhen,
      reminderWhen,
      details: noteDetails,
      reminderLabel: draft.reminderLabel.trim(),
      color: draft.color,
      priority: draft.priority,
      attachments: draft.attachments,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    };
    applyNotesUpdate((current) => {
      const nextBoard = {
        ...current,
        active: [note, ...current.active],
      };
      return nextBoard;
    });
    setBoardMode('active');
    setSelectedNoteId(note.id);
    closeComposer();
  }

  function archiveNote(noteId: string) {
    applyNotesUpdate((current) => {
      const note = current.active.find((item) => item.id === noteId);
      if (!note) return current;
      const nextBoard = {
        active: current.active.filter((item) => item.id !== noteId),
        archived: [
          {
            ...note,
            order: current.archived.length ? Math.max(...current.archived.map((item) => item.order)) + 1 : 1,
            ...getDefaultBoardPosition(current.archived.length),
            archivedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ...current.archived,
        ],
      };
      return nextBoard;
    });
    if (selectedNoteId === noteId) setSelectedNoteId(null);
  }

  function restoreNote(noteId: string) {
    applyNotesUpdate((current) => {
      const note = current.archived.find((item) => item.id === noteId);
      if (!note) return current;
      const nextBoard = {
        active: [
          {
            ...note,
            order: current.active.length ? Math.max(...current.active.map((item) => item.order)) + 1 : 1,
            ...getDefaultBoardPosition(current.active.length),
            archivedAt: null,
            updatedAt: new Date().toISOString(),
          },
          ...current.active,
          ],
        archived: current.archived.filter((item) => item.id !== noteId),
      };
      return nextBoard;
    });
  }

  function deleteNote(noteId: string) {
    applyNotesUpdate((current) => {
      const nextBoard = {
        active: current.active.filter((item) => item.id !== noteId),
        archived: current.archived.filter((item) => item.id !== noteId),
      };
      return nextBoard;
    });
    if (selectedNoteId === noteId) setSelectedNoteId(null);
  }

  function onDragStart(noteId: string) {
    setDraggingNoteId(noteId);
    setDragTarget(null);
  }

  function onDragEnd() {
    setDraggingNoteId(null);
    setDragTarget(null);
  }

  function distanceToRect(clientX: number, clientY: number, rect: DOMRect) {
    const deltaX = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const deltaY = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    return Math.hypot(deltaX, deltaY);
  }

  function getNearestDropTarget(clientX: number, clientY: number) {
    const archiveRect = archiveDropRef.current?.getBoundingClientRect();
    const deleteRect = deleteDropRef.current?.getBoundingClientRect();
    const archiveDistance = archiveRect ? distanceToRect(clientX, clientY, archiveRect) : Number.POSITIVE_INFINITY;
    const deleteDistance = deleteRect ? distanceToRect(clientX, clientY, deleteRect) : Number.POSITIVE_INFINITY;
    const proximityThreshold = 110;
    if (archiveDistance > proximityThreshold && deleteDistance > proximityThreshold) return null;
    return archiveDistance <= deleteDistance ? 'archive' : 'delete';
  }

  function onDropRailDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!draggingNoteId) return;
    setDragTarget(getNearestDropTarget(event.clientX, event.clientY));
  }

  function updateNotePosition(noteId: string, clientX: number, clientY: number) {
    const board = boardRef.current;
    if (!board) return;
    const bounds = board.getBoundingClientRect();
    const noteWidth = 288;
    const noteHeight = 240;
    const nextX = Math.min(Math.max(clientX - bounds.left - noteWidth / 2, 16), Math.max(16, bounds.width - noteWidth - 16));
    const nextY = Math.min(Math.max(clientY - bounds.top - 44, 16), Math.max(16, bounds.height - noteHeight - 16));
    applyNotesUpdate((current) => {
      const key = boardMode === 'active' ? 'active' : 'archived';
      const nextRows = current[key].map((note) => (note.id === noteId ? { ...note, x: nextX, y: nextY } : note));
      const nextBoard = key === 'active' ? { ...current, active: nextRows } : { ...current, archived: nextRows };
      return nextBoard;
    });
  }

  function startPointerNoteDrag(note: NoteRecord, event: PointerEvent<HTMLButtonElement>) {
    if (sortMode !== 'my_order' || event.button !== 0) return;
    pointerDragRef.current = {
      noteId: note.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: note.x,
      originY: note.y,
      lastX: note.x,
      lastY: note.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingNoteId(note.id);
    setDragTarget(null);
  }

  function movePointerNoteDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = pointerDragRef.current;
    if (!drag) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 6) return;

    drag.moved = true;
    suppressNextNoteClickRef.current = true;
    const board = boardRef.current;
    if (!board) return;
    const bounds = board.getBoundingClientRect();
    const noteWidth = 288;
    const noteHeight = 240;
    const nextX = Math.min(Math.max(drag.originX + deltaX, 16), Math.max(16, bounds.width - noteWidth - 16));
    const nextY = Math.min(Math.max(drag.originY + deltaY, 16), Math.max(16, bounds.height - noteHeight - 16));
    drag.lastX = nextX;
    drag.lastY = nextY;
    setDragTarget(getNearestDropTarget(event.clientX, event.clientY));
    setNotesState((current) => {
      const key = boardMode === 'active' ? 'active' : 'archived';
      const nextRows = current[key].map((note) => (note.id === drag.noteId ? { ...note, x: nextX, y: nextY } : note));
      return key === 'active' ? { ...current, active: nextRows } : { ...current, archived: nextRows };
    });
  }

  function endPointerNoteDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = pointerDragRef.current;
    pointerDragRef.current = null;
    if (!drag) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const target = drag.moved ? getNearestDropTarget(event.clientX, event.clientY) : null;
    if (target === 'archive') {
      animateAndRun(drag.noteId, 'archive', () => archiveNote(drag.noteId));
      return;
    }
    if (target === 'delete') {
      const shouldDelete = window.confirm('Delete this note permanently from the board?');
      if (shouldDelete) {
        animateAndRun(drag.noteId, 'delete', () => deleteNote(drag.noteId));
        return;
      }
    }

    if (drag.moved) {
      applyNotesUpdate((current) => {
        const key = boardMode === 'active' ? 'active' : 'archived';
        const nextRows = current[key].map((note) => (note.id === drag.noteId ? { ...note, x: drag.lastX, y: drag.lastY } : note));
        return key === 'active' ? { ...current, active: nextRows } : { ...current, archived: nextRows };
      });
    }
    setDraggingNoteId(null);
    setDragTarget(null);
  }

  function animateAndRun(noteId: string, action: 'archive' | 'delete', callback: () => void) {
    setPendingAction({ noteId, action });
    window.setTimeout(() => {
      callback();
      setPendingAction(null);
      setDraggingNoteId(null);
      setDragTarget(null);
    }, 260);
  }

  function onDropZoneEnter(target: 'archive' | 'delete', event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragTarget(target);
  }

  function onDropZoneDrop(target: 'archive' | 'delete', event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!draggingNoteId) return;
    if (target === 'archive') {
      animateAndRun(draggingNoteId, 'archive', () => archiveNote(draggingNoteId));
    } else {
      const shouldDelete = window.confirm('Delete this note permanently from the board?');
      if (shouldDelete) {
        animateAndRun(draggingNoteId, 'delete', () => deleteNote(draggingNoteId));
      } else {
        setDraggingNoteId(null);
        setDragTarget(null);
      }
    }
  }

  function openAttachment(attachment: NoteAttachment, noteTitle: string) {
    setViewer({ attachment, noteTitle });
    setImageZoom(1);
  }

  function saveSelectedNoteBody() {
    if (!selectedNote) return;
    const timestamp = new Date().toISOString();
    const nextDetails = stripAttachmentFramesFromHtml(selectedEditorRef.current?.innerHTML ?? selectedEditorHtml);
    applyNotesUpdate((current) => {
      const updateRows = (rows: NoteRecord[]) =>
        rows.map((note) =>
          note.id === selectedNote.id
            ? {
                ...note,
                details: nextDetails,
                updatedAt: timestamp,
              }
            : note,
        );
      const nextBoard = {
        active: updateRows(current.active),
        archived: updateRows(current.archived),
      };
      return nextBoard;
    });
  }

  return (
    <div className="min-w-0 space-y-5">
      <section className="app-hero relative overflow-hidden rounded-[28px] border border-white/70 px-5 py-4 shadow-panel sm:px-6 sm:py-4">
        <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_top,rgba(34,78,130,0.12),transparent_68%)]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-4 py-1.5 text-sm font-semibold text-navy shadow-sm">
                <StickyNote className="h-4 w-4" />
                Sticky Notes
              </div>
            <div className="hidden text-sm text-slate-600 sm:block">Local board</div>
          </div>
          <div className="grid min-w-0 w-full gap-2 sm:grid-cols-2 lg:grid-cols-4 lg:max-w-[45rem]">
            <div className="rounded-[18px] border border-white/70 bg-white/80 px-4 py-2.5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active</p>
              <p className="mt-1 text-xl font-semibold text-graphite">{activeCount}</p>
            </div>
            <div className="rounded-[18px] border border-white/70 bg-white/80 px-4 py-2.5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Urgent</p>
              <p className="mt-1 text-xl font-semibold text-graphite">{urgentCount}</p>
            </div>
            <div className="rounded-[18px] border border-white/70 bg-white/80 px-4 py-2.5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Files</p>
              <p className="mt-1 text-xl font-semibold text-graphite">{attachmentCount}</p>
            </div>
            <div className="rounded-[18px] border border-white/70 bg-white/80 px-4 py-2.5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Archived</p>
              <p className="mt-1 text-xl font-semibold text-graphite">{archivedCount}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm font-semibold text-navy shadow-sm hover:bg-white"
                onClick={() => openComposer()}
              >
                <Plus className="h-4 w-4" />
                New note
              </button>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-white/70 bg-white/70 p-4 shadow-[0_20px_60px_rgba(44,52,74,0.08)] backdrop-blur-sm sm:p-5 min-h-0">
        {saveError ? (
          <div className="mb-5 rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {saveError}
          </div>
        ) : null}

        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={clsx(
                'rounded-full px-4 py-2 text-sm font-semibold transition',
                boardMode === 'active' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700',
              )}
              onClick={() => setBoardMode('active')}
            >
              Active board
            </button>
            <button
              type="button"
              className={clsx(
                'rounded-full px-4 py-2 text-sm font-semibold transition',
                boardMode === 'archived' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700',
              )}
              onClick={() => setBoardMode('archived')}
            >
              Archived notes
            </button>
          </div>

          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search topics, details, tags..."
              className="pl-11"
            />
          </div>
        </div>

        {filteredNotes.length ? (
              <div className="relative">
                {sortMode === 'my_order' ? (
              <div
                ref={boardRef}
                className="relative min-h-[min(70dvh,calc(100dvh-12rem))] overflow-auto rounded-[28px] border border-dashed border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(245,247,251,0.85))]"
                style={{ height: boardHeight || undefined }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingNoteId && !dragTarget) updateNotePosition(draggingNoteId, event.clientX, event.clientY);
                  setDraggingNoteId(null);
                  setDragTarget(null);
                }}
              >
                {filteredNotes.map((note, index) => {
                  const color = getColorConfig(note.color);
                  const animationClass = pendingAction?.noteId === note.id
                    ? pendingAction.action === 'archive'
                      ? 'note-crush-archive'
                      : 'note-crush-delete'
                    : '';
                  const noteMotionStyle = {
                    '--note-rotation': `${index % 2 === 0 ? '-1.1deg' : '1deg'}`,
                  } as CSSProperties;
                  return (
                    <button
                      key={note.id}
                      type="button"
                      draggable={false}
                      onPointerDown={(event) => startPointerNoteDrag(note, event)}
                      onPointerMove={movePointerNoteDrag}
                      onPointerUp={endPointerNoteDrag}
                      onPointerCancel={endPointerNoteDrag}
                      onDragStart={() => onDragStart(note.id)}
                      onDragEnd={onDragEnd}
                      onClick={(event) => {
                        if (suppressNextNoteClickRef.current) {
                          suppressNextNoteClickRef.current = false;
                          event.preventDefault();
                          return;
                        }
                        setSelectedNoteId(note.id);
                      }}
                    className={clsx(
                        'group absolute w-[min(288px,calc(100%-1rem))] cursor-move overflow-hidden rounded-[26px] border p-5 text-left shadow-[0_22px_40px_rgba(33,44,66,0.12)] transition-all duration-300 hover:shadow-[0_28px_55px_rgba(33,44,66,0.15)] note-card-motion',
                        color.card,
                        color.edge,
                        draggingNoteId === note.id && 'opacity-70',
                        animationClass,
                      )}
                      style={{ left: note.x, top: note.y, ...noteMotionStyle }}
                    >
                      <div className={clsx('absolute inset-x-0 top-0 h-2', color.accent)} />
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-display text-2xl text-graphite">{note.topic}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/75 px-2.5 py-1">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatNoteTime(note.updatedAt)}
                            </span>
                            <span className={clsx('rounded-full px-2.5 py-1', priorityPillClasses[note.priority])}>
                              {note.priority}
                            </span>
                            {note.reminderLabel ? <span className="rounded-full bg-white/75 px-2.5 py-1">Tag: {note.reminderLabel}</span> : null}
                          </div>
                        </div>
                        <div className="rounded-full bg-white/70 p-2 text-slate-500">
                          <GripVertical className="h-4 w-4" />
                        </div>
                      </div>

                      {note.reminderWhen ? (
                        <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/75 px-2.5 py-1 text-xs font-semibold text-navy">
                          <Clock3 className="h-3.5 w-3.5 text-navy" />
                          Remind {formatReminderWhen(note.reminderWhen)}
                        </div>
                      ) : null}

                      <p className="mt-4 line-clamp-4 text-sm leading-6 text-slate-700">{stripHtml(note.details) || 'Open the note to add more details.'}</p>

                      <div className="mt-5 flex items-center justify-between text-xs font-semibold text-slate-600">
                        <span>{note.attachments.length ? `${note.attachments.length} attachment${note.attachments.length > 1 ? 's' : ''}` : 'No attachments'}</span>
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="h-3.5 w-3.5" />
                          Open
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredNotes.map((note, index) => {
                const color = getColorConfig(note.color);
                const animationClass = pendingAction?.noteId === note.id
                  ? pendingAction.action === 'archive'
                    ? 'note-crush-archive'
                    : 'note-crush-delete'
                  : '';
                const noteMotionStyle = {
                  '--note-rotation': `${index % 2 === 0 ? '-1.1deg' : '1deg'}`,
                } as CSSProperties;
                return (
                  <button
                    key={note.id}
                    type="button"
                    draggable={false}
                    onDragStart={() => onDragStart(note.id)}
                    onDragEnd={onDragEnd}
                    onClick={() => setSelectedNoteId(note.id)}
                  className={clsx(
                      'group relative overflow-hidden rounded-[26px] border p-5 text-left shadow-[0_22px_40px_rgba(33,44,66,0.12)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_28px_55px_rgba(33,44,66,0.15)] note-card-motion',
                      color.card,
                      color.edge,
                      animationClass,
                    )}
                    style={noteMotionStyle}
                  >
                    <div className={clsx('absolute inset-x-0 top-0 h-2', color.accent)} />
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-display text-2xl text-graphite">{note.topic}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/75 px-2.5 py-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatNoteTime(note.updatedAt)}
                          </span>
                          <span className={clsx('rounded-full px-2.5 py-1', priorityPillClasses[note.priority])}>
                            {note.priority}
                          </span>
                          {note.reminderLabel ? <span className="rounded-full bg-white/75 px-2.5 py-1">Tag: {note.reminderLabel}</span> : null}
                        </div>
                      </div>
                      <div className="rounded-full bg-white/70 p-2 text-slate-500">
                        <GripVertical className="h-4 w-4" />
                      </div>
                    </div>

                    {note.reminderWhen ? (
                      <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/75 px-2.5 py-1 text-xs font-semibold text-navy">
                        <Clock3 className="h-3.5 w-3.5 text-navy" />
                        Remind {formatReminderWhen(note.reminderWhen)}
                      </div>
                    ) : null}

                    <p className="mt-4 line-clamp-4 text-sm leading-6 text-slate-700">{stripHtml(note.details) || 'Open the note to add more details.'}</p>

                    <div className="mt-5 flex items-center justify-between text-xs font-semibold text-slate-600">
                      <span>{note.attachments.length ? `${note.attachments.length} attachment${note.attachments.length > 1 ? 's' : ''}` : 'No attachments'}</span>
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="h-3.5 w-3.5" />
                        Open
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            )}

            <div className="mt-6 flex justify-end">
              <div className="flex flex-wrap items-center gap-2 rounded-[22px] border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sort</span>
                <button
                  type="button"
                  className={clsx('rounded-full px-3 py-1.5 text-sm font-semibold transition', sortMode === 'my_order' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700')}
                  onClick={() => setSortMode('my_order')}
                >
                  My Order
                </button>
                <button
                  type="button"
                  className={clsx('rounded-full px-3 py-1.5 text-sm font-semibold transition', sortMode === 'priority' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700')}
                  onClick={() => setSortMode('priority')}
                >
                  Priority
                </button>
                <button
                  type="button"
                  className={clsx('inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition', sortMode === 'latest' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700')}
                  onClick={() => setSortMode('latest')}
                >
                  <ArrowDownAZ className="h-4 w-4" />
                  Latest
                </button>
                <button
                  type="button"
                  className={clsx('inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition', sortMode === 'oldest' ? 'bg-graphite text-white' : 'bg-slate-100 text-slate-700')}
                  onClick={() => setSortMode('oldest')}
                >
                  <ArrowUpAZ className="h-4 w-4" />
                  Oldest
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
            <StickyNote className="mx-auto h-10 w-10 text-slate-400" />
            <p className="mt-4 font-display text-3xl text-graphite">No notes on this board yet.</p>
            <p className="mt-2 text-slate-600">
              {boardMode === 'active' ? 'Create your first sticky note with the New note button.' : 'Archived notes will land here.'}
            </p>
          </div>
        )}
      </section>

      {draggingNoteId ? (
        <div
          ref={dropRailRef}
          className="fixed inset-x-0 bottom-0 z-50 flex min-h-[250px] items-end justify-center px-4 pb-4 pt-10"
          onDragOver={onDropRailDragOver}
          onDragLeave={() => setDragTarget(null)}
        >
          <div className="grid w-full max-w-6xl grid-cols-2 gap-4">
            <button
              type="button"
              className={clsx(
                'drop-zone-button relative flex min-h-[220px] flex-col justify-end rounded-[40px] border px-5 py-4 text-left shadow-2xl backdrop-blur-md transition-all duration-200 ease-out',
                dragTarget === 'archive'
                  ? 'drop-zone-archive-active border-amber-400 bg-amber-200 text-amber-900'
                  : 'border-amber-200 bg-amber-100 text-amber-800',
              )}
              ref={archiveDropRef}
              onDragOver={(event) => event.preventDefault()}
              onDragEnter={(event) => onDropZoneEnter('archive', event)}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(event) => onDropZoneDrop('archive', event)}
            >
              <span className="flex items-center gap-2 font-semibold">
                <Archive className="h-4 w-4" />
                Archive
              </span>
              <span className="mt-1 block text-sm">Moves the note off the board but keeps it saved.</span>
            </button>
            <button
              type="button"
              className={clsx(
                'drop-zone-button relative flex min-h-[220px] flex-col justify-end rounded-[40px] border px-5 py-4 text-left text-white shadow-2xl backdrop-blur-md transition-all duration-200 ease-out',
                dragTarget === 'delete'
                  ? 'drop-zone-delete-active border-rose-300 bg-rose-700'
                  : 'border-rose-300 bg-rose-500',
              )}
              ref={deleteDropRef}
              onDragOver={(event) => event.preventDefault()}
              onDragEnter={(event) => onDropZoneEnter('delete', event)}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(event) => onDropZoneDrop('delete', event)}
            >
              <span className="flex items-center gap-2 font-semibold">
                <Trash2 className="h-4 w-4" />
                Delete
              </span>
              <span className="mt-1 block text-sm text-white/80">We’ll ask for confirmation before removing it.</span>
            </button>
          </div>
        </div>
      ) : null}

      {isComposerOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-8" onClick={closeComposer}>
          <div
            className={clsx('relative max-h-[92vh] w-full max-w-4xl overflow-auto rounded-[34px] border p-6 shadow-[0_35px_90px_rgba(30,39,58,0.24)] sm:p-7', composerColor.panel, composerColor.panelBorder)}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
              onClick={closeComposer}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-5 flex items-center gap-3 pr-12">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-navy text-white shadow-sm">
                <NotebookPen className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-3xl text-navy-deep">{editingNoteId ? 'Edit note' : 'New note'}</h2>
              </div>
            </div>

            <form className="space-y-4" onSubmit={submitNote}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-navy">Topic</label>
                  <input
                    value={draft.topic}
                    onChange={(event) => setDraft((current) => ({ ...current, topic: event.target.value }))}
                    placeholder="Client collection, labour issue, material shortage..."
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-navy">Reminder</label>
                  <button
                    type="button"
                    className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-deep"
                    onClick={() => setShowReminderPicker((current) => !current)}
                  >
                    {showReminderPicker ? 'Hide reminder' : 'Set reminder'}
                  </button>
                  {showReminderPicker ? (
                    <div className="mt-3">
                      <input
                        type="datetime-local"
                        value={toDatetimeLocalValue(draft.reminderWhen)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            reminderWhen: event.target.value,
                            importantInfo: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_180px]">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-navy">Note page</label>
                  <div className="relative rounded-[28px] border border-amber-200 bg-white/90 p-4 shadow-inner">
                    <div
                      ref={composerEditorRef}
                      contentEditable
                      suppressContentEditableWarning
                      className="note-editor note-editor-sheet min-h-[min(26rem,50dvh)] max-h-[min(32.5rem,70dvh)] overflow-y-auto rounded-[20px] bg-surface px-8 py-7 pb-16 text-[16px] text-slate-800 outline-none"
                      onBlur={syncComposerDetailsFromDom}
                      onKeyDown={(event) => handleAttachmentUndoKeyDown(event, 'composer')}
                      onPaste={(event) => void handlePaste(event, 'composer')}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => void handleDrop(event, 'composer')}
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        const removeButton = target.closest('[data-attachment-remove]') as HTMLElement | null;
                        const removeId = removeButton?.dataset.attachmentRemove;
                        if (removeId) {
                          event.preventDefault();
                          event.stopPropagation();
                          removeAttachmentFromEditor('composer', removeId);
                          return;
                        }
                        const attachmentFrame = target.closest('[data-attachment-id]') as HTMLElement | null;
                        const attachmentId = attachmentFrame?.dataset.attachmentId;
                        if (!attachmentId) return;
                        const attachment = draft.attachments.find((item) => item.id === attachmentId);
                        if (attachment) {
                          openAttachment(attachment, draft.topic || 'Draft note');
                        }
                      }}
                    />
                    <label title={isUploadingAttachment ? 'Uploading attachment' : 'Add attachment'} className={clsx('absolute bottom-4 right-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-navy text-white shadow-lg transition hover:bg-navy-deep', isUploadingAttachment ? 'cursor-wait opacity-70' : 'cursor-pointer')}>
                      <Plus className={clsx('h-5 w-5', isUploadingAttachment && 'animate-pulse')} />
                      <input type="file" multiple disabled={isUploadingAttachment} className="hidden" onChange={(event) => void handleAttachmentInput(event)} />
                    </label>

                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-navy">Priority</label>
                    <div className="grid grid-cols-1 gap-2">
                      {(['urgent', 'high', 'medium', 'low'] as NotePriority[]).map((priority) => (
                        <button
                          key={priority}
                          type="button"
                          className={clsx(
                            'rounded-2xl px-3 py-2 text-sm font-semibold capitalize transition',
                            draft.priority === priority ? priorityPillClasses[priority] : 'bg-white/75 text-slate-600',
                          )}
                          onClick={() => setDraft((current) => ({ ...current, priority }))}
                        >
                          {priority}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-navy">Sticky color</label>
                    <div className="grid grid-cols-1 gap-2">
                      {noteColors.map((color) => (
                        <button
                          key={color.value}
                          type="button"
                          className={clsx(
                            'h-10 rounded-2xl border-2 transition',
                            color.card,
                            color.edge,
                            draft.color === color.value ? 'scale-105 ring-2 ring-navy/25' : 'opacity-80 hover:opacity-100',
                          )}
                          onClick={() => setDraft((current) => ({ ...current, color: color.value }))}
                          aria-label={`Choose ${color.value} note color`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white/80 p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="block text-sm font-semibold text-navy">Tag</label>
                  {draft.reminderLabel.trim() ? (
                    <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white">Selected: {draft.reminderLabel.trim()}</span>
                  ) : null}
                </div>
                <input
                  className="mt-3"
                  value={draft.reminderLabel}
                  onChange={(event) => setDraft((current) => ({ ...current, reminderLabel: event.target.value }))}
                  placeholder="Today, site visit, follow-up"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {getTagRecommendations(draft).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={clsx(
                        'rounded-full px-3 py-1.5 text-sm font-semibold transition',
                        draft.reminderLabel.trim().toLowerCase() === tag.toLowerCase()
                          ? 'bg-navy text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                      )}
                      onClick={() => setDraft((current) => ({ ...current, reminderLabel: tag }))}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={closeComposer}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-2xl bg-navy px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-navy-deep"
                  >
                    <Plus className="h-4 w-4" />
                    {editingNoteId ? 'Save changes' : 'Add sticky note'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedNote ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-8" onClick={() => setSelectedNoteId(null)}>
          <div
            className="relative max-h-[92vh] w-full max-w-4xl overflow-auto rounded-[34px] border border-white/70 bg-white p-6 shadow-panel sm:p-7"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
              onClick={() => setSelectedNoteId(null)}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {selectedNote.archivedAt ? 'Archived note' : 'Active note'}
                </span>
                <span className={clsx('rounded-full px-3 py-1 text-xs font-semibold capitalize', priorityPillClasses[selectedNote.priority])}>
                  {selectedNote.priority}
                </span>
                {selectedNote.reminderLabel ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    Tag: {selectedNote.reminderLabel}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-4 font-display text-4xl text-graphite">{selectedNote.topic}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-4 w-4" />
                  Created {formatNoteTime(selectedNote.createdAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-4 w-4" />
                  Updated {formatNoteTime(selectedNote.updatedAt)}
                </span>
              </div>
            </div>

            <div className="mt-7 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Note page</p>
                {!selectedNote.archivedAt ? (
                  <button
                    type="button"
                    className="rounded-2xl bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-deep"
                    onClick={saveSelectedNoteBody}
                  >
                    Save
                  </button>
                ) : null}
              </div>
              {selectedNote.archivedAt ? (
                <div
                  className="note-editor note-view-sheet mt-3 max-h-[460px] overflow-y-auto rounded-[22px] border border-slate-100 bg-surface px-8 py-7 text-base leading-8 text-slate-700"
                  dangerouslySetInnerHTML={{ __html: getNoteBodyHtml(selectedNote.details, selectedNote.attachments) }}
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    const attachmentFrame = target.closest('[data-attachment-id]') as HTMLElement | null;
                    const attachmentId = attachmentFrame?.dataset.attachmentId;
                    if (attachmentId) {
                      const attachment = selectedNote.attachments.find((item) => item.id === attachmentId);
                      if (attachment) {
                        openAttachment(attachment, selectedNote.topic);
                        return;
                      }
                    }
                    if (target.tagName === 'IMG') {
                      const image = target as HTMLImageElement;
                      openAttachment(
                        {
                          id: createId('inline-image'),
                          name: image.alt || `${selectedNote.topic} image`,
                          type: 'image/png',
                          size: 0,
                          dataUrl: image.src,
                        },
                        selectedNote.topic,
                      );
                    }
                  }}
                />
              ) : (
                <div className="mt-3 rounded-[24px] border border-amber-200 bg-white/90 p-4 shadow-inner">
                <div
                  ref={selectedEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="note-editor note-editor-sheet min-h-[min(26rem,50dvh)] max-h-[min(32.5rem,70dvh)] overflow-y-auto rounded-[20px] bg-surface px-8 py-7 pb-16 text-[16px] text-slate-800 outline-none"
                  onBlur={() => {
                    syncSelectedEditorFromDom();
                    saveSelectedNoteBody();
                  }}
                  onKeyDown={(event) => handleAttachmentUndoKeyDown(event, 'selected')}
                  onPaste={(event) => void handlePaste(event, 'selected')}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => void handleDrop(event, 'selected')}
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    const removeButton = target.closest('[data-attachment-remove]') as HTMLElement | null;
                    const removeId = removeButton?.dataset.attachmentRemove;
                    if (removeId) {
                      event.preventDefault();
                      event.stopPropagation();
                      removeAttachmentFromEditor('selected', removeId);
                      return;
                    }
                    const attachmentFrame = target.closest('[data-attachment-id]') as HTMLElement | null;
                    const attachmentId = attachmentFrame?.dataset.attachmentId;
                    if (!attachmentId || !selectedNote) return;
                    const attachment = selectedNote.attachments.find((item) => item.id === attachmentId);
                    if (attachment) {
                      openAttachment(attachment, selectedNote.topic);
                    }
                  }}
                />
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {selectedNote.archivedAt ? (
                <button
                  type="button"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    restoreNote(selectedNote.id);
                    setSelectedNoteId(selectedNote.id);
                    setBoardMode('active');
                  }}
                >
                  Restore to board
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    archiveNote(selectedNote.id);
                    setSelectedNoteId(null);
                    setBoardMode('archived');
                  }}
                >
                  Archive note
                </button>
              )}
              <button
                type="button"
                className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700"
                onClick={() => {
                  if (window.confirm('Delete this note permanently from the board?')) {
                    deleteNote(selectedNote.id);
                    setSelectedNoteId(null);
                  }
                }}
              >
                Delete note
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewer ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 px-4 py-8" onClick={() => setViewer(null)}>
          <div
            className="relative max-h-[min(94vh,100dvh)] w-full max-w-6xl overflow-hidden rounded-[32px] border border-white/10 bg-slate-900 text-white shadow-[0_35px_90px_rgba(15,23,42,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{viewer.attachment.name}</p>
                <p className="text-sm text-white/60">{viewer.noteTitle}</p>
              </div>
              <div className="flex items-center gap-2">
                {viewer.attachment.type.startsWith('image/') ? (
                  <>
                    <button
                      type="button"
                      className="rounded-full border border-white/15 bg-white/5 p-2 text-white/80 hover:bg-white/10"
                      onClick={() => setImageZoom((current) => Math.max(0.5, current - 0.2))}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-white/15 bg-white/5 p-2 text-white/80 hover:bg-white/10"
                      onClick={() => setImageZoom((current) => Math.min(3, current + 0.2))}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <a
                  href={viewer.attachment.dataUrl}
                  download={viewer.attachment.name}
                  className="rounded-full border border-white/15 bg-white/5 p-2 text-white/80 hover:bg-white/10"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  className="rounded-full border border-white/15 bg-white/5 p-2 text-white/80 hover:bg-white/10"
                  onClick={() => setViewer(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex max-h-[min(78vh,calc(100dvh-6rem))] items-center justify-center overflow-auto bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_45%)] p-6">
              {viewer.attachment.type.startsWith('image/') ? (
                <img
                  src={viewer.attachment.dataUrl}
                  alt={viewer.attachment.name}
                  className="max-h-full rounded-[24px] object-contain shadow-2xl transition-transform duration-200"
                  style={{ transform: `scale(${imageZoom})` }}
                />
              ) : viewer.attachment.type.includes('pdf') || viewer.attachment.type.startsWith('text/') ? (
                <iframe src={viewer.attachment.dataUrl} title={viewer.attachment.name} className="h-[min(78vh,calc(100dvh-10rem))] w-full rounded-[24px] bg-white" />
              ) : (
                <div className="rounded-[28px] border border-white/10 bg-white/5 p-8 text-center">
                  <FileText className="mx-auto h-10 w-10 text-white/70" />
                  <p className="mt-4 text-lg font-semibold">{viewer.attachment.name}</p>
                  <p className="mt-2 text-sm text-white/60">Preview is limited for this file type. Use download to open it fully.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
