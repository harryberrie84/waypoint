import { useEffect, useState } from 'react';
import { X, Swords } from 'lucide-react';
import { useCharacterForm } from '../store/useCharacterForm';
import { useData } from '../store/useData';
import { toast } from '../store/useToast';
import { emptyCharacter } from '../lib/character';
import type { CharacterSheet } from '../lib/character';
import { CharacterFields } from './CharacterFields';

// The /character form. Fill it in, get a character-sheet page, its own page in
// the sidebar, droppable onto a mindmap as a node you can wire to other players.
// Mounted once at the app root; the slash command flips useCharacterForm.open.

export function CharacterSheetForm() {
  const open = useCharacterForm((s) => s.open);
  const close = useCharacterForm((s) => s.close);
  const createCharacterPage = useData((s) => s.createCharacterPage);

  const [draft, setDraft] = useState<CharacterSheet>(emptyCharacter);
  const [saving, setSaving] = useState(false);

  // Fresh sheet each time the form opens; nothing carries over between characters.
  useEffect(() => {
    if (open) {
      setDraft(emptyCharacter());
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const submit = async () => {
    if (!draft.name.trim()) {
      toast('Give your character a name first.', 'error');
      return;
    }
    setSaving(true);
    const id = await createCharacterPage(draft);
    setSaving(false);
    if (id) {
      close();
      toast('Character sheet created.');
    } else {
      toast("Couldn't create the sheet.", 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[8vh] backdrop-blur-sm" onMouseDown={close}>
      <div
        className="flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
          <Swords className="h-4 w-4 text-clay" />
          <span className="flex-1 text-sm font-semibold text-ink dark:text-coal-text">New character</span>
          <button type="button" onClick={close} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <CharacterFields value={draft} onChange={setDraft} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-paper-line px-4 py-3 dark:border-coal-line">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-soft disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create sheet'}
          </button>
        </div>
      </div>
    </div>
  );
}
