import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Upload, Download, FileDown, Trash2, RotateCcw, Layers, PauseCircle, Zap, Image as ImageIcon, Volume2, Repeat2, Scissors, Play, Pencil, FolderOpen } from 'lucide-react';
import { useData } from '../store/useData';
import { useAuth } from '../store/useAuth';
import { uid } from '../lib/id';
import { uploadsApi } from '../lib/api';
import { processImageFile } from '../lib/image';
import { toast } from '../store/useToast';
import {
  buildQueue, buildCram, grade, gradePreview, forecast, dayIndex, deckStats, schedOf, withSched, setDueIn,
  emptyDeck, unitsOf, subDecks, pruneSched, migrateDeck,
  type Card, type Deck, type Grade, type Sched, type Unit,
} from '../lib/srs';
import { parseAnkiText, serializeAnkiText, parseApkg, ANKI_TEMPLATE, type AnkiImport } from '../lib/ankiIO';

// FlashcardsTab: an SM-2 deck on a page, importable from Anki.
//
// Page-scoped like every tab. Read-only until `pages.cards` is confirmed present,
// the Currency/Sheet deal: PocketBase drops an unknown field rather than
// rejecting the write, and a deck that exists in one browser is a trap.

const GRADES: { key: Grade; label: string; tone: string }[] = [
  { key: 'again', label: 'Again', tone: 'bg-red-500/90 hover:bg-red-500' },
  { key: 'hard', label: 'Hard', tone: 'bg-amber-500/90 hover:bg-amber-500' },
  { key: 'good', label: 'Good', tone: 'bg-clay hover:bg-clay-soft' },
  { key: 'easy', label: 'Easy', tone: 'bg-emerald-600/90 hover:bg-emerald-600' },
];

export function FlashcardsTab({ pageId, editable }: { pageId: string; editable: boolean }) {
  const page = useData((s) => s.pages[pageId]);
  const setPageCards = useData((s) => s.setPageCards);
  const fieldExists = useData((s) => s.pageCardsFieldExists);

  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void fieldExists(pageId).then((ok) => { if (live) setStored(ok); });
    return () => { live = false; };
  }, [fieldExists, pageId]);

  // Upgrade anything an older build wrote BEFORE reading it, so a deck reviewed
  // under the old shared-scheduling shape does not read as brand new. A no-op
  // on a modern deck, so it is safe to do on every render.
  // Scheduling is PER USER: the deck is shared, the progress is not.
  const me = useAuth((s) => s.user?.id ?? 'me');
  // Upgrade anything an older build wrote BEFORE reading it, so a deck reviewed
  // under the old shared-scheduling shape does not read as brand new. A no-op
  // on a modern deck, so it is safe to do on every render.
  const deck: Deck = useMemo(() => migrateDeck(page?.cards ?? emptyDeck(), me), [page?.cards, me]);
  const canEdit = editable && stored === true;

  const [mode, setMode] = useState<'decks' | 'review' | 'list'>('decks');
  const [subDeck, setSubDeck] = useState<string | null>(null); // null = all
  // Cram ignores scheduling and writes nothing back: the night-before drill.
  const [cram, setCram] = useState<Unit[] | null>(null);
  const [cramAt, setCramAt] = useState(0);
  const [shown, setShown] = useState(false); // is the answer revealed
  const [importOpen, setImportOpen] = useState(false);
  const today = dayIndex();

  const nowMs = Date.now();
  const queue = useMemo(() => buildQueue(deck, me, nowMs, subDeck ?? undefined), [deck, me, nowMs, subDeck]);
  const stats = useMemo(() => deckStats(deck, me, today), [deck, me, today]);
  const groups = useMemo(() => subDecks(deck), [deck]);
  const current: Unit | null = cram ? (cram[cramAt] ?? null) : (queue.due[0] ?? null);
  const currentSched = current ? schedOf(deck, me, current.key) : undefined;
  const preview = current ? gradePreview(currentSched, nowMs, deck) : null;

  const save = (next: Partial<Deck>) => setPageCards(pageId, { ...deck, ...next });

  const answer = (g: Grade) => {
    if (!current) return;
    // Cram writes NOTHING back. That is what makes it safe to drill a deck you
    // are mid-way through without wrecking its schedule.
    if (cram) {
      setCramAt((i) => i + 1);
      setShown(false);
      return;
    }
    if (!canEdit) return;
    setPageCards(pageId, withSched(deck, me, current.key, grade(currentSched, g, nowMs, deck), { day: today, grade: g }));
    setShown(false);
  };

  // "Show me this again in N days", Anki's set-due-date. Sometimes you know a
  // card is not needed until Friday and no button on the row says Friday.
  const pushOut = (unitKey: string, days: number) =>
    setPageCards(pageId, withSched(deck, me, unitKey, setDueIn(schedOf(deck, me, unitKey), days, today)));

  const toggleSuspend = (unitKey: string) => {
    const s = schedOf(deck, me, unitKey);
    const base: Sched = s ?? { interval: 0, ease: 2.5, due: today, reps: 0, lapses: 0 };
    // Un-suspending a leech clears the tag too, or it would be re-suspended
    // by its own history the moment it is answered again.
    const next = { ...base, suspended: !base.suspended, leech: base.suspended ? false : base.leech };
    setPageCards(pageId, withSched(deck, me, unitKey, next));
  };

  // Renaming a deck is a rename across its cards: the deck IS the name, there is
  // no separate record to keep in step, which is why two of them can never drift.
  const renameDeck = (from: string, to: string) => {
    const name = to.trim();
    if (name === from) return;
    save({ cards: deck.cards.map((c) => ((c.deck ?? '') === from ? { ...c, deck: name || undefined } : c)) });
    if (subDeck === from) setSubDeck(name || null);
  };

  const deleteDeck = (name: string) => {
    const keep = deck.cards.filter((c) => (c.deck ?? '') !== name);
    setPageCards(pageId, pruneSched({ ...deck, cards: keep }, me));
    if (subDeck === name) setSubDeck(null);
  };

  const studyDeck = (name: string | null) => {
    setSubDeck(name);
    setCram(null);
    setShown(false);
    setMode('review');
  };

  const startCram = () => {
    const units = buildCram(deck, { subDeck: subDeck ?? undefined });
    if (!units.length) return;
    setCram(units);
    setCramAt(0);
    setShown(false);
    setMode('review');
  };

  // Space reveals, 1-4 grade. Inert while a field owns the keyboard so typing a
  // card's text never also answers the one on screen.
  useEffect(() => {
    if (mode !== 'review' || (!canEdit && !cram)) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === ' ') { e.preventDefault(); setShown((s) => !s); return; }
      if (!shown) return;
      const at = ['1', '2', '3', '4'].indexOf(e.key);
      if (at >= 0) { e.preventDefault(); answer(GRADES[at].key); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const addCards = (incoming: AnkiImport, label: string) => {
    if (incoming.problem) { toast(incoming.problem, 'error'); return; }
    if (!incoming.cards.length) { toast('Nothing in that file could be read as a card.', 'error'); return; }
    // Every import lands in its OWN deck, so uploading three files gives three
    // decks that each keep their own counts rather than one undifferentiated pile.
    const name = (incoming.deck ?? '').trim();
    save({ cards: [...deck.cards, ...incoming.cards.map((c) => ({ ...c, id: uid('fc_'), deck: c.deck ?? name ?? undefined }))] });
    toast(`${incoming.cards.length} card${incoming.cards.length === 1 ? '' : 's'} added from ${label}${incoming.skipped ? `, ${incoming.skipped} skipped` : ''}`);
    setImportOpen(false);
  };

  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!page) return null;
  const bars = forecast(deck, me, 14, today);
  const peak = Math.max(1, ...bars);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-paper-line px-3 py-2 dark:border-coal-line">
        <div className="flex items-center gap-1 rounded-lg border border-paper-line p-0.5 dark:border-coal-line">
          {(['decks', 'review', 'list'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${mode === m ? 'bg-clay text-white' : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line'}`}
            >
              {m}
            </button>
          ))}
        </div>
        {groups.length > 1 && (
          <select
            value={subDeck ?? ''}
            onChange={(e) => { setSubDeck(e.target.value || null); setCram(null); }}
            title="narrow to a sub-deck"
            className="rounded-md border border-paper-line bg-transparent px-1.5 py-1 text-xs text-ink-soft outline-none dark:border-coal-line dark:text-coal-soft"
          >
            <option value="">All decks</option>
            {groups.filter((g) => g.name).map((g) => {
              const c = buildQueue(deck, me, nowMs, g.name).counts;
              return <option key={g.name} value={g.name}>{g.name} ({c.learning + c.review + c.new} of {g.units})</option>;
            })}
          </select>
        )}
        <span className="text-xs text-ink-faint dark:text-coal-soft">
          {queue.counts.learning} learning · {queue.counts.review} due · {queue.counts.new} new · {queue.counts.total} cards
          {queue.counts.leeches ? ` · ${queue.counts.leeches} leech${queue.counts.leeches === 1 ? '' : 'es'}` : ''}
        </span>
        <span className="hidden text-xs text-ink-faint sm:inline dark:text-coal-soft" title="your own progress on this deck">
          {stats.reviewsToday} today{stats.streak > 1 ? ` · ${stats.streak}-day streak` : ''}
          {stats.retention !== null ? ` · ${stats.retention}% kept` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {canEdit && (
            <>
              <button type="button" onClick={cram ? () => setCram(null) : startCram} title={cram ? 'stop cramming' : 'drill everything, ignoring the schedule, writing nothing back'} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${cram ? 'border-clay bg-clay/10 text-clay' : 'border-paper-line text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line'}`}>
                <Zap className="h-3.5 w-3.5" /> {cram ? 'Stop' : 'Cram'}
              </button>
              <button type="button" onClick={() => setImportOpen(true)} title="import from Anki" className="flex items-center gap-1 rounded-md border border-paper-line px-2 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line">
                <Upload className="h-3.5 w-3.5" /> Import
              </button>
              <button
                type="button"
                onClick={() => save({ cards: [...deck.cards, { id: uid('fc_'), front: '', back: '' }] })}
                title="add a card"
                className="rounded-md border border-paper-line p-1.5 text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => download(serializeAnkiText(deck.cards, page.title || 'Waypoint'), 'deck.txt')}
            title="export for Anki (Notes in Plain Text)"
            className="rounded-md border border-paper-line p-1.5 text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {stored === false && (
        <p className="border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200">
          This deck is read-only. Ask whoever runs this Waypoint to finish the setup, then it will save and sync.
        </p>
      )}

      {mode === 'decks' ? (
        <DeckList
          groups={groups}
          countsFor={(name) => buildQueue(deck, me, nowMs, name || undefined).counts}
          editable={canEdit}
          onStudy={studyDeck}
          onRename={renameDeck}
          onDelete={deleteDeck}
          onExport={(name) => download(
            serializeAnkiText(deck.cards.filter((c) => (c.deck ?? '') === name), name || (page.title || 'Waypoint')),
            `${(name || 'deck').replace(/[^\w.-]+/g, '-')}.txt`,
          )}
          total={queue.counts}
        />
      ) : mode === 'review' ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
          {cram && (
            <p className="rounded-full bg-clay/10 px-3 py-1 text-xs font-medium text-clay">
              cramming {Math.min(cramAt + 1, cram.length)} of {cram.length} · nothing is being saved
            </p>
          )}
          {!current ? (
            <div className="text-center">
              <Layers className="mx-auto mb-2 h-8 w-8 text-ink-faint" />
              <p className="text-sm text-ink-soft dark:text-coal-soft">
                {cram ? 'End of the drill.' : deck.cards.length ? 'Nothing due. Come back tomorrow.' : 'No cards yet. Import an Anki deck or add one.'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border border-paper-line bg-paper p-6 shadow-sm dark:border-coal-line dark:bg-coal-panel">
                {current.media?.front && <img src={current.media.front} alt="" className="max-h-40 rounded-lg object-contain" />}
                <p className="whitespace-pre-wrap text-center text-xl font-medium text-ink dark:text-coal-text">{current.front || '(blank)'}</p>
                {shown && <div className="w-full border-t border-paper-line pt-3 dark:border-coal-line" />}
                {shown && current.media?.back && <img src={current.media.back} alt="" className="max-h-40 rounded-lg object-contain" />}
                {shown && <p className="whitespace-pre-wrap text-center text-base text-ink-soft dark:text-coal-soft">{current.back || '(blank)'}</p>}
                {/* Audio is available from the FRONT. On a listening card the sound
                    IS the question, so hiding it until the answer is revealed makes
                    it look like it does nothing. */}
                {current.media?.audio && <audio controls src={current.media.audio} className="h-8 w-full max-w-xs" />}
                {current.tags?.length ? (
                  <div className="flex flex-wrap justify-center gap-1">
                    {current.tags.map((t) => (
                      <span key={t} className="rounded bg-paper-panel px-1.5 py-0.5 text-[10px] text-ink-faint dark:bg-coal-line dark:text-coal-soft">{t}</span>
                    ))}
                  </div>
                ) : null}
              </div>
              {!shown ? (
                <button type="button" onClick={() => setShown(true)} className="rounded-lg bg-clay px-6 py-2 text-sm font-semibold text-white hover:bg-clay-soft">
                  Show answer <span className="ml-1 opacity-70">space</span>
                </button>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {GRADES.map((g, i) => (
                    <button
                      key={g.key}
                      type="button"
                      disabled={!canEdit && !cram}
                      onClick={() => answer(g.key)}
                      className={`flex min-w-[5rem] flex-col items-center rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${g.tone}`}
                    >
                      {g.label}
                      <span className="text-[10px] font-normal opacity-80">{preview ? preview[g.key] : ''} · {i + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {deck.cards.length > 0 && (
            <div className="flex items-end gap-0.5" title="cards due over the next two weeks">
              {bars.map((n, i) => (
                <span key={i} className="w-2 rounded-sm bg-clay/60" style={{ height: Math.max(2, (n / peak) * 28) }} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!deck.cards.length && <p className="py-8 text-center text-sm text-ink-faint dark:text-coal-soft">no cards yet</p>}
          <div className="space-y-1">
            {deck.cards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                today={today}
                editable={canEdit}
                sched={schedOf(deck, me, unitsOf(card)[0]?.key ?? card.id)}
                unitCount={unitsOf(card).length}
                onChange={(patch) => save({ cards: deck.cards.map((c) => (c.id === card.id ? { ...c, ...patch } : c)) })}
                onReset={() => { let d = deck; for (const u of unitsOf(card)) d = withSched(d, me, u.key, null); setPageCards(pageId, d); }}
                onPush={(days) => unitsOf(card).forEach((u) => pushOut(u.key, days))}
                onSuspend={() => unitsOf(card).forEach((u) => toggleSuspend(u.key))}
                onDelete={() => setPageCards(pageId, pruneSched({ ...deck, cards: deck.cards.filter((c) => c.id !== card.id) }, me))}
              />
            ))}
          </div>
        </div>
      )}

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onText={(text) => addCards(parseAnkiText(text), 'the text file')}
          onApkg={async (buf, name) => addCards(await parseApkg(buf, name), name ? `"${name}"` : 'the Anki deck')}
          onTemplate={() => download(ANKI_TEMPLATE, 'anki-template.txt')}
        />
      )}
    </div>
  );
}

function CardRow({ card, sched, unitCount, today, editable, onChange, onReset, onPush, onSuspend, onDelete }: {
  card: Card;
  sched: Sched | undefined;
  unitCount: number;
  today: number;
  editable: boolean;
  onChange: (patch: Partial<Card>) => void;
  onReset: () => void;
  onPush: (days: number) => void;
  onSuspend: () => void;
  onDelete: () => void;
}) {
  const due = sched?.leech ? 'leech' : sched?.suspended ? 'held' : sched === undefined ? 'new' : sched.due <= today ? 'due' : `${sched.due - today}d`;
  const [open, setOpen] = useState(false);
  const pickMedia = async (slot: 'front' | 'back' | 'audio', file: File) => {
    const url = slot === 'audio'
      ? await uploadsApi.upload(file)
      : ((await uploadsApi.upload(file)) ?? (await processImageFile(file)));
    // Say so rather than silently doing nothing: a rejected upload used to look
    // exactly like a working one that produced no sound.
    if (!url) { toast(`Could not add that ${slot}. It may be too large for this Waypoint.`, 'error'); return; }
    onChange({ media: { ...(card.media ?? {}), [slot]: url } });
  };
  return (
    <div className="rounded-lg border border-paper-line px-2 py-1.5 dark:border-coal-line">
      <div className="flex items-start gap-2">
      <input
        value={card.front}
        disabled={!editable}
        onChange={(e) => onChange({ front: e.target.value })}
        placeholder="front"
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint/60 disabled:opacity-70 dark:text-coal-text"
      />
      <input
        value={card.back}
        disabled={!editable}
        onChange={(e) => onChange({ back: e.target.value })}
        placeholder="back"
        className="min-w-0 flex-1 bg-transparent text-sm text-ink-soft outline-none placeholder:text-ink-faint/60 disabled:opacity-70 dark:text-coal-soft"
      />
      <span className="shrink-0 rounded bg-paper-panel px-1.5 py-0.5 text-[10px] tabular-nums text-ink-faint dark:bg-coal-line dark:text-coal-soft">{due}</span>
      {editable && (
        <>
          <select
            value=""
            onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) onPush(v); e.target.value = ''; }}
            title="show it again in..."
            className="shrink-0 rounded border border-paper-line bg-transparent px-1 py-0.5 text-[10px] text-ink-faint outline-none dark:border-coal-line dark:text-coal-soft"
          >
            <option value="">in…</option>
            {[1, 3, 7, 14, 30, 90].map((d) => (
              <option key={d} value={d}>{d}d</option>
            ))}
          </select>
          <button type="button" onClick={onSuspend} title={sched?.suspended ? 'put it back in rotation' : 'hold it out of rotation'} className={`shrink-0 rounded p-1 hover:bg-paper-panel dark:hover:bg-coal-line ${sched?.suspended ? 'text-clay' : 'text-ink-faint'}`}>
            <PauseCircle className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onReset} title="forget its schedule and treat it as new" className="shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setOpen((o) => !o)} title="cloze, reverse, sub-deck, media" className={`shrink-0 rounded p-1 hover:bg-paper-panel dark:hover:bg-coal-line ${open ? 'text-clay' : 'text-ink-faint'}`}>
            <Scissors className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onDelete} title="delete" className="shrink-0 rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      </div>

      {open && editable && (
        <div className="mt-2 space-y-2 border-t border-paper-line/60 pt-2 dark:border-coal-line/60">
          <textarea
            value={card.cloze ?? ''}
            onChange={(e) => onChange({ cloze: e.target.value })}
            rows={2}
            placeholder={'Cloze, e.g. The capital of {{c1::Japan}} is {{c2::Tokyo}}. One card per deletion; overrides front/back.'}
            className="w-full resize-none rounded-md border border-paper-line bg-paper px-2 py-1 font-mono text-[11px] text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
          />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft dark:text-coal-soft">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={!!card.reverse} onChange={(e) => onChange({ reverse: e.target.checked })} />
              <Repeat2 className="h-3 w-3" /> also ask it backwards
            </label>
            <input
              value={card.deck ?? ''}
              onChange={(e) => onChange({ deck: e.target.value })}
              placeholder="sub-deck"
              className="w-28 rounded border border-paper-line bg-paper px-1.5 py-0.5 text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
            />
            <input
              value={(card.tags ?? []).join(' ')}
              onChange={(e) => onChange({ tags: e.target.value.split(/\s+/).filter(Boolean) })}
              placeholder="tags"
              className="w-32 rounded border border-paper-line bg-paper px-1.5 py-0.5 text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
            />
            <span className="opacity-70">{unitCount} card{unitCount === 1 ? '' : 's'} from this note</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['front', 'back', 'audio'] as const).map((slot) => (
              <label key={slot} className="flex cursor-pointer items-center gap-1 rounded border border-dashed border-paper-line px-2 py-1 text-[11px] text-ink-soft hover:border-clay hover:text-clay dark:border-coal-line dark:text-coal-soft">
                {slot === 'audio' ? <Volume2 className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                {card.media?.[slot] ? `${slot} set` : `add ${slot}`}
                <input
                  type="file"
                  accept={slot === 'audio' ? 'audio/*' : 'image/*'}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickMedia(slot, f); }}
                />
              </label>
            ))}
            {card.media && Object.keys(card.media).length > 0 && (
              <button type="button" onClick={() => onChange({ media: undefined })} className="text-[11px] text-ink-faint hover:text-red-500">
                clear media
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportModal({ onClose, onText, onApkg, onTemplate }: {
  onClose: () => void;
  onText: (text: string) => void;
  onApkg: (buf: ArrayBuffer, name?: string) => void | Promise<void>;
  onTemplate: () => void;
}) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-paper-line bg-paper p-4 shadow-2xl dark:border-coal-line dark:bg-coal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-sm font-semibold text-ink dark:text-coal-text">Import from Anki</h3>
        <p className="mb-2 text-xs text-ink-soft dark:text-coal-soft">
          Pick an <b>.apkg</b> deck, or paste a "Notes in Plain Text" export. Scheduling is not carried across, so
          cards start fresh here.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={'front<tab>back<tab>tags\n\nor use "Choose a file" for an .apkg'}
          className="w-full resize-none rounded-lg border border-paper-line bg-paper px-2 py-1.5 font-mono text-xs text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onText(text)} className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-soft">Import text</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line">
            Choose a file…
          </button>
          <button type="button" onClick={onTemplate} className="flex items-center gap-1 rounded-lg border border-paper-line px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line">
            <FileDown className="h-3.5 w-3.5" /> Template
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".apkg,.txt,.tsv,.csv,text/plain"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.name.toLowerCase().endsWith('.apkg')) await onApkg(await f.arrayBuffer(), f.name.replace(/\.apkg$/i, ''));
              else onText(await f.text());
            }}
          />
        </div>
      </div>
    </div>
  );
}

// The deck list: what Anki opens on. One row per deck with its own counts, so
// several imported decks stay legible instead of becoming one pile. The counts
// come from the same buildQueue the review screen uses, per deck, so the number
// on the row is exactly what you will be shown when you press it.
function DeckList({ groups, countsFor, editable, onStudy, onRename, onDelete, onExport, total }: {
  groups: { name: string; units: number }[];
  countsFor: (name: string) => { new: number; learning: number; review: number; later: number; suspended: number; leeches: number; total: number };
  editable: boolean;
  onStudy: (name: string | null) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onExport: (name: string) => void;
  total: { new: number; learning: number; review: number; total: number };
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!groups.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Layers className="h-8 w-8 text-ink-faint" />
        <p className="text-sm text-ink-soft dark:text-coal-soft">No decks yet. Import an Anki file, or add a card.</p>
      </div>
    );
  }

  const Num = ({ n, tone, title }: { n: number; tone: string; title: string }) => (
    <span title={title} className={`w-8 text-right tabular-nums ${n ? tone : 'text-ink-faint/40 dark:text-coal-soft/40'}`}>{n}</span>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft">
        <span className="flex-1">Deck</span>
        <span className="w-8 text-right" title="in learning">Lrn</span>
        <span className="w-8 text-right" title="due for review">Due</span>
        <span className="w-8 text-right" title="not seen yet">New</span>
        <span className="w-24" />
      </div>

      {groups.length > 1 && (
        <button
          type="button"
          onClick={() => onStudy(null)}
          className="mb-2 flex w-full items-center gap-2 rounded-lg border border-clay/40 bg-clay/5 px-2 py-2 text-left hover:bg-clay/10"
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-clay" />
          <span className="flex-1 text-sm font-medium text-ink dark:text-coal-text">Everything</span>
          <Num n={total.learning} tone="text-amber-600 dark:text-amber-400" title="in learning" />
          <Num n={total.review} tone="text-clay" title="due" />
          <Num n={total.new} tone="text-sky-600 dark:text-sky-400" title="new" />
          <span className="w-24 text-right text-xs text-ink-faint dark:text-coal-soft">{total.total} cards</span>
        </button>
      )}

      <div className="space-y-1">
        {groups.map((g) => {
          const c = countsFor(g.name);
          const waiting = c.learning + c.review + c.new;
          return (
            <div key={g.name || '__root__'} className="rounded-lg border border-paper-line dark:border-coal-line">
              <div className="flex items-center gap-2 px-2 py-2">
                {renaming === g.name ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { onRename(g.name, draft); setRenaming(null); }
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => { onRename(g.name, draft); setRenaming(null); }}
                    className="min-w-0 flex-1 rounded border border-paper-line bg-paper px-1.5 py-0.5 text-sm text-ink outline-none dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  />
                ) : (
                  <button type="button" onClick={() => onStudy(g.name || null)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <Play className="h-3.5 w-3.5 shrink-0 text-clay" />
                    <span className="truncate text-sm font-medium text-ink dark:text-coal-text">{g.name || 'Ungrouped'}</span>
                    {waiting === 0 && <span className="shrink-0 text-[10px] text-ink-faint dark:text-coal-soft">done for today</span>}
                  </button>
                )}
                <Num n={c.learning} tone="text-amber-600 dark:text-amber-400" title="in learning" />
                <Num n={c.review} tone="text-clay" title="due" />
                <Num n={c.new} tone="text-sky-600 dark:text-sky-400" title="new" />
                <div className="flex w-24 items-center justify-end gap-0.5">
                  <button type="button" onClick={() => onExport(g.name)} title="export this deck for Anki" className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  {editable && (
                    <>
                      <button type="button" onClick={() => { setRenaming(g.name); setDraft(g.name); }} title="rename" className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setConfirming(confirming === g.name ? null : g.name)} title="delete this deck" className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {confirming === g.name && (
                <div className="flex items-center gap-2 border-t border-paper-line bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-coal-line dark:bg-red-900/20 dark:text-red-300">
                  <span className="flex-1">Delete {g.units} card{g.units === 1 ? '' : 's'} in "{g.name || 'Ungrouped'}"? This cannot be undone.</span>
                  <button type="button" onClick={() => { onDelete(g.name); setConfirming(null); }} className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-500">
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="rounded px-2 py-0.5 hover:bg-red-100 dark:hover:bg-red-900/40">
                    Keep
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
