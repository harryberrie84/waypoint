import { useEffect, useRef, useState } from 'react';
import { Plus, X, CalendarDays, Mic, Camera } from 'lucide-react';
import { useData } from '../store/useData';
import { toast } from '../store/useToast';
import { processImageFile, ImageTooLargeError } from '../lib/image';
import { uploadsApi } from '../lib/api';

// CaptureBar, a floating button that opens a one-field sheet to jot a line into
// the Inbox without navigating anywhere. This is the "just write it down"
// shortcut that otherwise sends people to the stock Notes app. The same path
// backs the OS share target (App reads the shared text and calls captureToInbox).
//
// Two lower-friction inputs for phones: a mic (browser speech-to-text, no
// dependency) so a parent can talk instead of type, and a camera so a photo of a
// receipt or whiteboard lands straight in the Inbox.

// Minimal Web Speech API shape, it isn't in the DOM lib types.
interface SpeechResultLike {
  0: { transcript: string };
}
interface SpeechEventLike {
  results: ArrayLike<SpeechResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function CaptureBar() {
  const captureToInbox = useData((s) => s.captureToInbox);
  const captureImageToInbox = useData((s) => s.captureImageToInbox);
  const openDailyNote = useData((s) => s.openDailyNote);
  const commentsOpen = useData((s) => s.commentsOpen);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const voiceSupported = recognitionCtor() !== null;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Stop any in-flight recognition when the sheet closes.
  useEffect(() => {
    if (!open && recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setListening(false);
    }
  }, [open]);

  const save = () => {
    const line = text.trim();
    if (!line) return;
    void captureToInbox(line).then((id) => {
      if (id) toast('saved to inbox');
    });
    setText('');
    setOpen(false);
  };

  const today = () => {
    setOpen(false);
    void openDailyNote();
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? '';
      if (said) setText((t) => (t ? `${t} ${said}` : said));
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  // Upload the photo and keep the url; the inline data URL is the fallback for a
  // server with no uploads collection. Every captured photo used to be embedded
  // whole into the Inbox body, which shares one ~2MB field, so a few receipts and
  // the next capture had nowhere to go.
  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    void uploadsApi
      .upload(file)
      .then(async (url) => url ?? (await processImageFile(file)))
      .then((src) => captureImageToInbox(src))
      .then((id) => {
        if (id) toast('photo saved to inbox');
        setOpen(false);
      })
      .catch((e) => toast(e instanceof ImageTooLargeError ? e.message : 'could not read that photo', 'error'));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          'fixed bottom-safe z-[100] flex h-12 w-12 items-center justify-center rounded-full bg-clay text-white shadow-lg transition-all hover:bg-clay-soft',
          // Slide left of the comments rail (w-80) when it is open on desktop.
          commentsOpen ? 'right-5 md:right-[21.5rem]' : 'right-5',
        ].join(' ')}
        title="Quick capture"
        aria-label="Quick capture"
      >
        <Plus className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[131] flex items-end justify-center bg-coal/30 p-3 pb-safe backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-ink dark:text-coal-text">quick capture</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line dark:hover:text-coal-text"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
              rows={3}
              placeholder={listening ? 'listening…' : 'jot something down'}
              className="w-full resize-none rounded-lg border border-paper-line bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint/60 focus:border-clay dark:border-coal-line dark:bg-coal dark:text-coal-text"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPhoto(e.target.files?.[0])}
            />
            <div className="mt-2 flex items-center gap-1.5">
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={[
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs',
                    listening
                      ? 'bg-clay text-white'
                      : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
                  ].join(' ')}
                  title={listening ? 'stop' : 'speak'}
                >
                  <Mic className="h-3.5 w-3.5" /> {listening ? 'stop' : 'speak'}
                </button>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
                title="Add a photo"
              >
                <Camera className="h-3.5 w-3.5" /> photo
              </button>
              <button
                type="button"
                onClick={today}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
                title="Open today's note"
              >
                <CalendarDays className="h-3.5 w-3.5" /> today
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!text.trim()}
                className="ml-auto rounded-lg bg-clay px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-clay-soft disabled:opacity-40"
              >
                add
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
