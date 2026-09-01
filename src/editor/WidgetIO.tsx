import { useState } from 'react';
import { Download, Upload, FileDown, Copy } from 'lucide-react';
import { toast } from '../store/useToast';

// WidgetIO, the shared Download / Copy / Template / Import toolbar the concert-kit
// widgets (setlist, quiz) have, factored out so any attr-backed widget gets the
// same "author it in a file or the clipboard" round-trip with one line. The block
// hands over a text serializer, a blank template, and an import handler; this owns
// the buttons, the collapsible paste box, and the file download.

export function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const btn = 'rounded-md p-1.5 text-ink-faint hover:bg-paper-panel hover:text-ink dark:hover:bg-coal-line';

export function WidgetIO({
  fileName,
  templateName,
  templateText,
  getText,
  onImport,
}: {
  fileName: string;
  templateName: string;
  templateText: string;
  getText: () => string;
  // Return false to keep the paste box open (nothing imported); anything else closes it.
  onImport: (text: string) => boolean | void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const load = () => {
    if (onImport(text) !== false) {
      setOpen(false);
      setText('');
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-0.5">
        <button type="button" onClick={() => downloadText(fileName, getText())} className={btn} title="Export to a text file">
          <Download className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(getText());
            toast('Copied');
          }}
          className={btn}
          title="Copy as text"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => downloadText(templateName, templateText)} className={btn} title="Download a blank template">
          <FileDown className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} className={btn} title="Import from text">
          <Upload className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Paste here, then Load…"
            className="w-full resize-y rounded-md border border-paper-line bg-paper p-2 font-mono text-xs text-ink outline-none dark:border-coal-line dark:bg-coal-panel dark:text-coal-text"
          />
          <div className="mt-1 flex items-center gap-1.5">
            <button type="button" onClick={load} className="rounded-lg bg-clay px-3 py-1 text-xs font-medium text-white hover:bg-clay/90">
              Load
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setText('');
              }}
              className="rounded-lg px-3 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
