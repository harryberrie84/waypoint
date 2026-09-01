import { ABILITIES, CLASSES, abilityMod, formatMod, proficiencyBonus } from '../lib/character';
import type { AbilityKey, CharacterSheet } from '../lib/character';

// The editable body of a character sheet, shared by the create modal and the
// in-block edit mode so the two never drift. Controlled: it owns no state, just
// renders `value` and calls `onChange` with the next sheet.

interface Props {
  value: CharacterSheet;
  onChange: (next: CharacterSheet) => void;
}

const inputCls =
  'w-full rounded-lg border border-paper-line bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-clay dark:border-coal-line dark:bg-coal-panel dark:text-coal-text';
const labelCls = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-coal-soft';

export function CharacterFields({ value, onChange }: Props) {
  const set = (patch: Partial<CharacterSheet>) => onChange({ ...value, ...patch });
  const setAbility = (key: AbilityKey, score: number) =>
    onChange({ ...value, abilities: { ...value.abilities, [key]: score } });

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Name</label>
        <input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Vex the Bold"
          className={inputCls}
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Player</label>
          <input value={value.player} onChange={(e) => set({ player: e.target.value })} placeholder="who runs them" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Race</label>
          <input value={value.race} onChange={(e) => set({ race: e.target.value })} placeholder="Wood Elf" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Class</label>
          <input
            value={value.className}
            onChange={(e) => set({ className: e.target.value })}
            placeholder="Ranger"
            list="character-classes"
            className={inputCls}
          />
          <datalist id="character-classes">
            {CLASSES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={labelCls}>Level</label>
          <input
            type="number"
            min={1}
            max={20}
            value={value.level}
            onChange={(e) => set({ level: clampInt(e.target.value, 1, 1, 20) })}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Background</label>
          <input value={value.background} onChange={(e) => set({ background: e.target.value })} placeholder="Outlander" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Alignment</label>
          <input value={value.alignment} onChange={(e) => set({ alignment: e.target.value })} placeholder="CG" className={inputCls} />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className={labelCls + ' mb-0'}>Ability scores</label>
          <span className="text-[11px] text-ink-faint dark:text-coal-soft">proficiency {formatMod(proficiencyBonus(value.level))}</span>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {ABILITIES.map(({ key, label }) => (
            <div key={key} className="rounded-lg border border-paper-line p-1.5 text-center dark:border-coal-line">
              <div className="text-[10px] font-semibold text-ink-faint dark:text-coal-soft">{label}</div>
              <input
                type="number"
                value={value.abilities[key]}
                onChange={(e) => setAbility(key, clampInt(e.target.value, 10, 1, 30))}
                className="w-full bg-transparent text-center text-sm font-semibold text-ink outline-none dark:text-coal-text"
              />
              <div className="text-[11px] tabular-nums text-clay">{formatMod(abilityMod(value.abilities[key]))}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Max HP</label>
          <input type="number" min={0} value={value.maxHp} onChange={(e) => set({ maxHp: clampInt(e.target.value, 0, 0, 9999) })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>AC</label>
          <input type="number" min={0} value={value.ac} onChange={(e) => set({ ac: clampInt(e.target.value, 0, 0, 99) })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Speed</label>
          <input type="number" min={0} value={value.speed} onChange={(e) => set({ speed: clampInt(e.target.value, 0, 0, 999) })} className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Notes</label>
        <textarea
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="features, gear, bonds, the thing they'd never admit…"
          rows={3}
          className={inputCls + ' resize-y'}
        />
      </div>
    </div>
  );
}

// Number inputs hand back strings (and '' while mid-edit); keep the sheet's
// numbers real and inside sane bounds rather than letting NaN through.
function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
