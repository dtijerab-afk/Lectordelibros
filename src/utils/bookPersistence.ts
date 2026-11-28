import {
  DocumentAnalysis,
  ExtractedPage,
  PdfOutlineItem,
  QuizQuestion,
  RealWorldAdaptationItem,
} from '../data/enamoratePreset';

export interface PersistedOpenEval {
  isCorrect: boolean;
  score: number;
  feedback: string;
  missingConcepts: string[];
}

export interface PersistedChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
  groundingStatus?: string;
  timestamp: string;
}

export interface PersistedBookSession {
  version: 1;
  savedAt: string;
  fileName: string;
  pageCount: number;
  pages: ExtractedPage[];
  outline: PdfOutlineItem[];
  documentText: string;
  analysis: DocumentAnalysis;
  questions: QuizQuestion[];
  selectedOptions: Record<string, number>;
  openAnswersDraft: Record<string, string>;
  openEvaluations: Record<string, PersistedOpenEval>;
  exploredChapters: Record<number, boolean>;
  customChapterAdaptations: Record<number, RealWorldAdaptationItem>;
  chatMessages: PersistedChatMsg[];
  activeChapterIdx: number;
}

const DB_NAME = 'LecturaVivaDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const ACTIVE_KEY = 'active-book-v1';
const LS_FALLBACK_KEY = 'lecturaviva_active_session_v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export async function saveBookSession(session: PersistedBookSession): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(session, ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    });
    db.close();
    return true;
  } catch {
    // Graceful localStorage fallback for smaller books if IndexedDB is blocked
    try {
      const serialized = JSON.stringify(session);
      if (serialized.length < 4_200_000) {
        localStorage.setItem(LS_FALLBACK_KEY, serialized);
        return true;
      }
    } catch {
      // Ignore quota exceeded
    }
    return false;
  }
}

export async function loadBookSession(): Promise<PersistedBookSession | null> {
  try {
    const db = await openDb();
    const record = await new Promise<PersistedBookSession | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(ACTIVE_KEY);
      req.onsuccess = () => resolve(req.result as PersistedBookSession | undefined);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
    db.close();
    if (record && record.version === 1 && record.analysis) {
      return record;
    }
  } catch {
    // Fallback to localStorage
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedBookSession;
    if (parsed && parsed.version === 1 && parsed.analysis) {
      return parsed;
    }
  } catch {
    // Ignore corrupt cache
  }
  return null;
}

export async function clearBookSession(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
    });
    db.close();
  } catch {
    // Ignore
  }
  try {
    localStorage.removeItem(LS_FALLBACK_KEY);
  } catch {
    // Ignore
  }
}
