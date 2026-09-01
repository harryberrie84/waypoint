import { useEffect, useMemo, useState } from 'react';
import { Users, X, Mail, Shield, Eye, Pencil, Trash2, Clock, Dices, SlidersHorizontal, Lock, Hash, Download, Upload, Image as ImageIcon, ShieldCheck, ShieldAlert, Home } from 'lucide-react';
import { readZip, type ZipEntry } from '../lib/unzip';
import { parseNotionExport } from '../lib/notionImport';
import { presenceApi, uploadsApi } from '../lib/api';
import { processImageFile } from '../lib/image';
import { EmojiPicker } from './EmojiPicker';
import { useAuth } from '../store/useAuth';
import { useData, selectWorkspacePages } from '../store/useData';
import { loadLanding, saveLanding, LANDING_EVENT } from '../lib/landing';
import { useWorkspace } from '../store/useWorkspace';
import { useVault } from '../store/useVault';
import { useWorkspaceKeys } from '../store/useWorkspaceKeys';
import { toast, toastWithAction } from '../store/useToast';
import { confirmAsk } from '../store/useConfirm';
import { FileTrashPanel } from './FileTrashPanel';
import { PageIcon } from './PageIcon';
import { validateInviteEmail } from '../lib/workspace';
import { makeZip, type ZipFile } from '../lib/zip';
import { pageToMarkdown, safeFileName } from '../lib/backup';
import { parseBackup, assembleBackup, BACKUP_README, type BackupFile } from '../lib/restoreBackup';
import { tableToCSV } from '../lib/csv';
import { isEnvelope, displayTitle, keyFingerprint } from '../lib/crypto';
import { seeKey, trustKey, type KeyTrust } from '../lib/keyTrust';
import type { WorkspaceRole, NumberStyle, CellValue } from '../types';

// SettingsPanel, one place for everything about the active workspace, with a
// left nav: "Workspace" (the tabletop switch and workspace identity) and
// "Members" (the roster, invites, roles). Replaces the old members-only modal so
// workspace settings aren't buried inside the people list.
//
// Members come from workspace_members, not a global user list. Admins invite by
// email, change roles, and remove people; everyone else reads. Online status
// derives from presence heartbeats. Pre-migration (no backend) it falls back to
// the synthesized default workspace and disables invites with a note.

const ONLINE_MS = 45_000;
const POLL_MS = 10_000;

const ROLE_META: Record<WorkspaceRole, { icon: typeof Shield; label: string }> = {
  admin: { icon: Shield, label: 'admin' },
  editor: { icon: Pencil, label: 'editor' },
  viewer: { icon: Eye, label: 'viewer' },
};

type Section = 'workspace' | 'members';

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: Section;
}

export function SettingsPanel({ open, onClose, initial = 'members' }: Props) {
  const me = useAuth((s) => s.user);
  const activeId = useWorkspace((s) => s.activeWorkspaceId);
  const defaultWorkspaceId = useWorkspace((s) => s.defaultWorkspaceId);
  const pages = useData((s) => s.pages);
  const workspaces = useWorkspace((s) => s.workspaces);
  const allMembers = useWorkspace((s) => s.members);
  const allInvites = useWorkspace((s) => s.invites);
  const roster = useWorkspace((s) => s.roster);
  const usingDefault = useWorkspace((s) => s.usingDefault);
  const myRole = useWorkspace((s) => s.myRole);
  const renameWorkspace = useWorkspace((s) => s.renameWorkspace);
  const setWorkspaceIcon = useWorkspace((s) => s.setWorkspaceIcon);
  const invite = useWorkspace((s) => s.invite);
  const cancelInvite = useWorkspace((s) => s.cancelInvite);
  const [wsIconOpen, setWsIconOpen] = useState(false);
  const removeMember = useWorkspace((s) => s.removeMember);
  const setMemberRole = useWorkspace((s) => s.setMemberRole);
  const tabletop = useWorkspace((s) => s.tabletopEnabled());
  const setWorkspaceTabletop = useWorkspace((s) => s.setWorkspaceTabletop);
  const encrypted = useWorkspace((s) => s.encryptedEnabled());
  const setWorkspaceEncrypted = useWorkspace((s) => s.setWorkspaceEncrypted);
  const deleteWorkspace = useWorkspace((s) => s.deleteWorkspace);
  const numberStyle = useWorkspace((s) => s.numberStyle());
  const setWorkspaceNumberStyle = useWorkspace((s) => s.setWorkspaceNumberStyle);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The workspace's home page (per-browser, same value the sidebar house icon
  // sets). List the workspace's own pages so you can pick where it opens.
  const homePages = useMemo(
    () =>
      Object.values(selectWorkspacePages(pages, activeId, defaultWorkspaceId))
        .filter((p) => !p.trashed && !p.template)
        .sort((a, b) => displayTitle(a.title).localeCompare(displayTitle(b.title))),
    [pages, activeId, defaultWorkspaceId],
  );
  const [homePage, setHomePage] = useState<string>(() => loadLanding(activeId) ?? '');
  useEffect(() => {
    const sync = () => setHomePage(loadLanding(activeId) ?? '');
    sync();
    window.addEventListener(LANDING_EVENT, sync);
    return () => window.removeEventListener(LANDING_EVENT, sync);
  }, [activeId]);

  const vaultStatus = useVault((s) => s.status);
  const openVault = useVault((s) => s.openPanel);
  const migrateWorkspace = useWorkspaceKeys((s) => s.migrateWorkspace);
  const decryptWorkspace = useWorkspaceKeys((s) => s.decryptWorkspace);
  const [migrating, setMigrating] = useState(false);

  const runMigrate = async () => {
    if (vaultStatus !== 'unlocked') {
      openVault();
      return;
    }
    if (!activeId) return;
    setMigrating(true);
    const n = await migrateWorkspace(activeId);
    setMigrating(false);
    // Counts pages and table rows, so say "items" not "pages".
    toast(`encrypted ${n} ${n === 1 ? 'item' : 'items'}`);
  };

  const runDecrypt = async () => {
    if (vaultStatus !== 'unlocked') {
      openVault();
      return;
    }
    if (!activeId) return;
    setMigrating(true);
    const n = await decryptWorkspace(activeId);
    setMigrating(false);
    // Counts pages and table rows, so say "items" not "pages".
    toast(`decrypted ${n} ${n === 1 ? 'item' : 'items'}`);
  };

  const [importingNotion, setImportingNotion] = useState(false);
  const runNotionImport = async (file: File | undefined) => {
    if (!file) return;
    setImportingNotion(true);
    try {
      let entries = await readZip(await file.arrayBuffer());
      // Notion wraps the real export in one or more inner "Part" zips; unwrap them.
      const parts = entries.filter((e) => e.name.toLowerCase().endsWith('.zip'));
      if (parts.length) {
        const inner: ZipEntry[] = [];
        for (const z of parts) inner.push(...(await readZip(z.bytes.slice().buffer)));
        entries = inner;
      }
      const plan = parseNotionExport(entries);
      const found = plan.workspaces.reduce((n, w) => n + w.pages.length, 0);
      if (!found) {
        toast('no Notion pages found in that .zip', 'error');
        return;
      }
      const res = await useData.getState().importNotion(plan);
      const imgs = res.images ? `, ${res.images} image${res.images === 1 ? '' : 's'}` : '';
      toast(`imported ${res.pages} pages, ${res.tables} tables${imgs} into ${res.workspaces} workspace${res.workspaces === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('[settings] notion import failed', err);
      toast('could not read that export', 'error');
    } finally {
      setImportingNotion(false);
    }
  };

  const [exporting, setExporting] = useState(false);
  const runExport = async () => {
    if (!activeId) return;
    const data = useData.getState();
    const wk = useWorkspaceKeys.getState();
    const defaultId = useWorkspace.getState().defaultWorkspaceId;
    const inWs = (ws?: string) => (ws || defaultId) === activeId;
    const pages = Object.values(data.pages)
      .filter((p) => !p.trashed && inWs(p.workspace))
      .sort((a, b) => a.order - b.order);
    const tables = Object.values(data.tables).filter((t) => inWs(t.workspace) && !t.formKey);
    const tableIds = new Set(tables.map((t) => t.id));

    // Encrypted content needs the vault to read it back in the clear: page
    // bodies and titles, and any row whose cells still sit in a cellsEnc blob.
    const hasEncrypted =
      pages.some((p) => isEnvelope(p.content) || isEnvelope(p.title)) ||
      Object.values(data.rows).some((r) => (r.cellsEnc || r.contentEnc) && tableIds.has(r.table));
    if (hasEncrypted && vaultStatus !== 'unlocked') {
      openVault();
      toast('unlock your vault so the backup can include encrypted pages', 'error');
      return;
    }

    setExporting(true);
    try {
      const files: ZipFile[] = [];
      const used = new Set<string>();
      const uniq = (base: string) => {
        let n = base;
        let i = 2;
        while (used.has(n.toLowerCase())) n = `${base} (${i++})`;
        used.add(n.toLowerCase());
        return n;
      };

      files.push({ name: 'README.md', content: BACKUP_README });

      for (const p of pages) {
        let content: unknown = p.content;
        if (isEnvelope(content)) {
          try {
            content = await wk.decryptForWorkspace(p.workspace ?? '', content as string);
          } catch {
            content = null;
          }
        }
        let title = p.title;
        if (isEnvelope(title)) {
          try {
            title = String(await wk.decryptForWorkspace(p.workspace ?? '', title));
          } catch {
            title = '';
          }
        }
        title = displayTitle(title);
        const name = uniq(safeFileName(title, p.id));
        files.push({ name: `pages/${name}.md`, content: pageToMarkdown(title, content) });
        files.push({
          name: `data/pages/${name}.json`,
          content: JSON.stringify(
            {
              id: p.id,
              title,
              parent: p.parent,
              workspace: p.workspace ?? '',
              icon: p.icon,
              cover: p.cover,
              content,
              map: p.map,
              mindmap: p.mindmap,
              flow: p.flow,
              kanban: p.kanban,
              // The page's other own data. Leaving these out meant a backup quietly
              // did not carry a tier list, a currency board, or the entire Photos and
              // Files attachment list, which is the sort of thing you discover on the
              // day you need the backup.
              tierlist: p.tierlist,
              rates: p.rates,
              sheet: p.sheet,
              cards: p.cards,
              rota: p.rota,
              bracket: p.bracket,
              photos: p.photos,
              files: p.files,
              defaultTab: p.defaultTab,
            },
            null,
            2,
          ),
        });
      }

      for (const t of tables) {
        const rows = Object.values(data.rows)
          .filter((r) => r.table === t.id)
          .sort((a, b) => a.position - b.position);
        // Rows still holding an unopened cellsEnc blob decrypt here (the vault
        // gate above ran), so the backup carries every cell in the clear.
        const jsonRows: object[] = [];
        const csvRows: typeof rows = [];
        for (const r of rows) {
          let cells = r.cells;
          if (r.cellsEnc) {
            try {
              const secret = await wk.decryptForWorkspace(t.workspace ?? '', r.cellsEnc);
              if (secret && typeof secret === 'object') cells = { ...r.cells, ...(secret as Record<string, CellValue>) };
            } catch (err) {
              console.error('[settings] export: row decrypt failed', err);
            }
          }
          jsonRows.push({ id: r.id, parent: r.parent, cells, content: r.content ?? null });
          csvRows.push({ ...r, cells });
        }
        const name = uniq(safeFileName(t.name, t.id));
        files.push({ name: `tables/${name}.csv`, content: tableToCSV(t.columns, csvRows, roster) });
        files.push({
          name: `data/tables/${name}.json`,
          content: JSON.stringify(
            { id: t.id, name: t.name, workspace: t.workspace ?? '', columns: t.columns, views: t.views ?? null, automations: t.automations ?? null, rows: jsonRows },
            null,
            2,
          ),
        });
      }

      files.push({
        name: 'manifest.json',
        content: JSON.stringify({ waypointBackup: 2, workspace: active?.name ?? '', exportedAt: new Date().toISOString(), pages: pages.length, tables: tables.length }, null, 2),
      });

      const blob = makeZip(files);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFileName(active?.name ?? 'workspace', 'workspace')}-backup.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`backed up ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} and ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}`);
    } catch (err) {
      console.error('[settings] export failed', err);
      toast('could not build the backup', 'error');
    } finally {
      setExporting(false);
    }
  };

  const [restoring, setRestoring] = useState(false);
  const runRestore = async (file: File | undefined) => {
    if (!file) return;
    // Restoring writes page content; in an encrypted workspace that has to be
    // encrypted on the way in, which needs the vault unlocked.
    if (encrypted && vaultStatus !== 'unlocked') {
      openVault();
      toast('unlock your vault before restoring into an encrypted workspace', 'error');
      return;
    }
    // Parse first (no changes yet). Accept the whole backup.zip (per-entity
    // data/ files, or an older monolithic backup.json), or a bare .json file.
    let backup: BackupFile;
    try {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const entries = (await readZip(await file.arrayBuffer())).filter((e) => e.name.toLowerCase().endsWith('.json'));
        const dec = new TextDecoder();
        backup = assembleBackup(entries.map((e) => ({ name: e.name, text: dec.decode(e.bytes) })));
      } else {
        backup = parseBackup(await file.text());
      }
    } catch (err) {
      console.error('[settings] restore parse failed', err);
      toast(err instanceof Error ? err.message : 'could not read that backup', 'error');
      return;
    }
    if (!(backup.pages.length + backup.tables.length)) {
      toast('that backup has no pages or tables', 'error');
      return;
    }
    // Ask in the app's own confirm (like the widget delete), then restore in the
    // callback. Restore is additive (nothing existing changes), and the Undo
    // toast removes exactly what it created.
    confirmAsk({
      title: 'Restore this backup?',
      message: `Adds ${backup.pages.length} page${backup.pages.length === 1 ? '' : 's'} and ${backup.tables.length} table${backup.tables.length === 1 ? '' : 's'} into "${active?.name ?? 'this workspace'}" as new copies. Nothing existing is changed. You can undo right after.`,
      confirmLabel: 'Restore',
      destructive: false,
      onConfirm: async () => {
        setRestoring(true);
        try {
          const res = await useData.getState().restoreBackup(backup);
          // Button-only undo (a store op, not an editor edit), so no ctrl+z hint.
          toastWithAction(`Restored ${res.pages} page${res.pages === 1 ? '' : 's'}, ${res.tables} table${res.tables === 1 ? '' : 's'} and ${res.rows} row${res.rows === 1 ? '' : 's'}.`, {
            label: 'Undo',
            run: () => void useData.getState().undoRestore(res.created),
          });
        } catch (err) {
          console.error('[settings] restore failed', err);
          toast(err instanceof Error ? err.message : 'could not restore that backup', 'error');
        } finally {
          setRestoring(false);
        }
      },
    });
  };

  const [section, setSection] = useState<Section>(initial);
  const [online, setOnline] = useState<Map<string, 'viewing' | 'editing'>>(new Map());
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('editor');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const active = workspaces.find((w) => w.id === activeId);
  // One row per user, guards against any duplicate membership rows so nobody
  // (especially you, the creator) shows up twice.
  const members = useMemo(() => {
    const seen = new Set<string>();
    return allMembers.filter((m) => {
      if (m.workspace !== activeId || seen.has(m.user)) return false;
      seen.add(m.user);
      return true;
    });
  }, [allMembers, activeId]);
  const invites = useMemo(
    () => allInvites.filter((i) => i.workspace === activeId && i.status === 'pending'),
    [allInvites, activeId],
  );
  const amAdmin = myRole() === 'admin';
  const amOwner = !usingDefault && !!active && active.owner === me?.id; // server delete rule is owner-only
  const adminCount = members.filter((m) => m.role === 'admin').length;

  // Key-trust: a per-member fingerprint of their public key to compare out of
  // band, plus a trust status (pinned on first sight; 'changed' means the key
  // differs from the pin and must be re-verified before granting).
  const myPublicKey = useVault((s) => s.publicKey);
  const regrantMembers = useWorkspaceKeys((s) => s.regrantMembers);
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const [keyTrust, setKeyTrust] = useState<Record<string, KeyTrust>>({});
  const [myFingerprint, setMyFingerprint] = useState('');
  const [pinBump, setPinBump] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const fps: Record<string, string> = {};
      const trust: Record<string, KeyTrust> = {};
      for (const m of members) {
        const pub = m.publicKey;
        if (!pub) continue;
        try {
          fps[m.user] = await keyFingerprint(pub);
        } catch {
          /* malformed key; leave it out of the map */
        }
        if (m.user !== me?.id) trust[m.user] = seeKey(m.user, pub); // pin on sight
      }
      let mine = '';
      if (myPublicKey) {
        try {
          mine = await keyFingerprint(myPublicKey);
        } catch {
          /* ignore */
        }
      }
      if (alive) {
        setFingerprints(fps);
        setKeyTrust(trust);
        setMyFingerprint(mine);
      }
    })();
    return () => {
      alive = false;
    };
  }, [members, myPublicKey, me?.id, pinBump]);

  const verifyMemberKey = (userId: string, publicKey: string) => {
    trustKey(userId, publicKey); // pin the current key as trusted
    if (activeId) void regrantMembers(activeId); // re-grant now that it's trusted (no-op if already has the key)
    setPinBump((n) => n + 1); // recompute statuses so the warning clears
  };

  const runDelete = async () => {
    if (!activeId) return;
    const ok = await deleteWorkspace(activeId);
    setConfirmDelete(false);
    if (ok) {
      toast('workspace deleted');
      onClose();
    } else {
      toast('could not delete the workspace', 'error');
    }
  };

  // Re-sync to the requested tab each time the panel opens.
  useEffect(() => {
    if (open) {
      setSection(initial);
      setConfirmDelete(false);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      let presence: Awaited<ReturnType<typeof presenceApi.listAll>> = [];
      try {
        presence = await presenceApi.listAll();
      } catch {
        /* nobody online */
      }
      const cutoff = Date.now() - ONLINE_MS;
      const m = new Map<string, 'viewing' | 'editing'>();
      for (const p of presence) if (new Date(p.heartbeat).getTime() >= cutoff) m.set(p.user, p.mode);
      if (!cancelled) setOnline(m);
    };
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [open]);

  if (!open) return null;

  const takenEmails = invites.map((i) => i.email);

  const submitInvite = async () => {
    const check = validateInviteEmail(email, takenEmails);
    if (!check.ok) {
      setErr(check.reason);
      return;
    }
    setSending(true);
    setErr(null);
    const ok = await invite(check.email, inviteRole);
    setSending(false);
    if (ok) setEmail('');
    else setErr('Could not send the invite.');
  };

  const isOnline = (userId: string) => userId === me?.id || online.has(userId);

  const NavButton = ({ id, icon: Icon, label }: { id: Section; icon: typeof Users; label: string }) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      className={[
        'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
        section === id
          ? 'bg-clay-wash font-medium text-clay dark:bg-clay/20 dark:text-clay-soft'
          : 'text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[10vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-paper-line bg-paper shadow-2xl dark:border-coal-line dark:bg-coal-panel sm:flex-row"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Left nav (vertical on desktop, a tab strip on phones). */}
        <nav className="flex shrink-0 gap-1 border-b border-paper-line p-2 dark:border-coal-line sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">
          <div className="hidden items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint dark:text-coal-soft sm:flex">
            Settings
          </div>
          <NavButton id="workspace" icon={SlidersHorizontal} label="Workspace" />
          <NavButton id="members" icon={Users} label="Members" />
        </nav>

        {/* Content. min-h-0 so the inner area can actually scroll on mobile (the
            modal is a column there); without it the bottom buttons get clipped. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-paper-line px-4 py-3 dark:border-coal-line">
            <span className="flex-1 text-sm font-semibold text-ink dark:text-coal-text">
              {section === 'workspace' ? 'Workspace' : 'Members'}
            </span>
            <button type="button" onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-paper-panel dark:hover:bg-coal-line">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {section === 'workspace' ? (
              <div className="p-4">
                {(() => {
                  const amAdmin = !!activeId && myRole(activeId) === 'admin' && !usingDefault;
                  return (
                    <div className="mb-4 flex items-center gap-3">
                      <div className="relative">
                        <button
                          type="button"
                          disabled={!amAdmin}
                          onClick={() => setWsIconOpen((o) => !o)}
                          title={amAdmin ? 'Change workspace icon' : undefined}
                          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-paper-panel text-xl hover:bg-paper-line disabled:hover:bg-paper-panel dark:bg-coal-line dark:hover:bg-coal"
                        >
                          <PageIcon icon={active?.icon} fallback="🗺️" size="h-full w-full" />
                        </button>
                        {wsIconOpen && amAdmin && (
                          <div className="absolute left-0 top-full z-30 mt-1 rounded-lg border border-paper-line bg-paper p-2 shadow-xl dark:border-coal-line dark:bg-coal-panel">
                            <EmojiPicker
                              onSelect={(em) => {
                                void setWorkspaceIcon(activeId, em);
                                setWsIconOpen(false);
                              }}
                            />
                            <label className="mt-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-ink-soft hover:bg-paper-panel dark:text-coal-soft dark:hover:bg-coal-line">
                              <ImageIcon className="h-3.5 w-3.5" /> Upload an image
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    const url = (await uploadsApi.upload(file)) ?? (await processImageFile(file));
                                    if (url) void setWorkspaceIcon(activeId, url);
                                  } catch {
                                    /* ignore */
                                  }
                                  setWsIconOpen(false);
                                }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {amAdmin ? (
                          <input
                            defaultValue={active?.name ?? ''}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== active?.name) void renameWorkspace(activeId, v);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className="w-full bg-transparent text-sm font-medium text-ink outline-none dark:text-coal-text"
                          />
                        ) : (
                          <div className="truncate text-sm font-medium text-ink dark:text-coal-text">{active?.name ?? 'Workspace'}</div>
                        )}
                        <div className="text-[11px] text-ink-faint dark:text-coal-soft">
                          {members.length} {members.length === 1 ? 'member' : 'members'}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Tabletop tools, admin-only switch for the whole workspace. */}
                <div className="flex items-center gap-3 rounded-lg border border-paper-line px-3 py-3 dark:border-coal-line">
                  <Dices className="h-4 w-4 shrink-0 text-clay" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink dark:text-coal-text">Tabletop &amp; D&amp;D tools</div>
                    <p className="text-[11px] text-ink-faint dark:text-coal-soft">
                      dice, campaign tables, initiative and character sheets, for everyone here
                    </p>
                  </div>
                  <Switch
                    on={tabletop}
                    disabled={!amAdmin}
                    onToggle={() => void setWorkspaceTabletop(!tabletop)}
                    title={amAdmin ? (tabletop ? 'turn tabletop tools off' : 'turn tabletop tools on') : 'admins only'}
                  />
                </div>

                {/* Number format, Swedish (comma OR dot decimals) by default. */}
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-paper-line px-3 py-3 dark:border-coal-line">
                  <Hash className="h-4 w-4 shrink-0 text-clay" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink dark:text-coal-text">Number format</div>
                    <p className="text-[11px] text-ink-faint dark:text-coal-soft">
                      how decimals are typed. Swedish takes a comma or a dot (12,50 = 12.50).
                    </p>
                  </div>
                  <select
                    value={numberStyle}
                    disabled={!amAdmin}
                    onChange={(e) => void setWorkspaceNumberStyle(e.target.value as NumberStyle)}
                    title={amAdmin ? 'how numbers are read here' : 'admins only'}
                    className="shrink-0 rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink disabled:opacity-50 dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  >
                    <option value="swedish">Swedish (12,50)</option>
                    <option value="standard">Standard (12.50)</option>
                  </select>
                </div>

                {/* Home page: which page this workspace opens to. Personal + per-
                    device (localStorage), so it isn't admin-gated. */}
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-paper-line px-3 py-3 dark:border-coal-line">
                  <Home className="h-4 w-4 shrink-0 text-clay" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink dark:text-coal-text">Home page</div>
                    <p className="text-[11px] text-ink-faint dark:text-coal-soft">
                      the page this workspace opens to when you switch into it. your own choice, synced to your
                      account across your devices (not shared with other members). a refresh still returns to
                      whatever page you were on.
                    </p>
                  </div>
                  <select
                    value={homePages.some((p) => p.id === homePage) ? homePage : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      saveLanding(activeId, v || null);
                      setHomePage(v);
                    }}
                    title="pick where this workspace opens"
                    className="max-w-[11rem] shrink-0 truncate rounded-md border border-paper-line bg-paper px-2 py-1 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                  >
                    <option value="">First page (default)</option>
                    {homePages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {displayTitle(p.title) || 'Untitled'}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Encrypt-by-default, members only can read new content. */}
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-paper-line px-3 py-3 dark:border-coal-line">
                  <Lock className="h-4 w-4 shrink-0 text-clay" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink dark:text-coal-text">Encrypt this workspace</div>
                    <p className="text-[11px] text-ink-faint dark:text-coal-soft">
                      new page content is encrypted so only members can read it (not even the server). existing pages
                      keep working and encrypt the next time they're edited.
                    </p>
                  </div>
                  <Switch
                    on={encrypted}
                    disabled={!amAdmin}
                    onToggle={() => void setWorkspaceEncrypted(!encrypted)}
                    title={amAdmin ? (encrypted ? 'turn encryption off' : 'turn encryption on') : 'admins only'}
                  />
                </div>
                {encrypted && amAdmin && (
                  <button
                    type="button"
                    onClick={() => void runMigrate()}
                    disabled={migrating}
                    className="mt-2 w-full rounded-lg border border-paper-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-paper-panel disabled:opacity-50 dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
                  >
                    {migrating ? 'encrypting existing pages…' : 'encrypt existing pages now'}
                  </button>
                )}
                {!encrypted && amAdmin && (
                  <button
                    type="button"
                    onClick={() => void runDecrypt()}
                    disabled={migrating}
                    className="mt-2 w-full rounded-lg border border-paper-line px-3 py-2 text-xs font-medium text-ink-soft hover:bg-paper-panel disabled:opacity-50 dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
                  >
                    {migrating ? 'decrypting existing pages…' : 'decrypt existing pages now'}
                  </button>
                )}
                {!amAdmin && (
                  <p className="mt-2 text-[11px] text-ink-faint dark:text-coal-soft">only an admin can change workspace settings.</p>
                )}

                {usingDefault && (
                  <p className="mt-3 rounded-lg bg-paper-panel px-3 py-2 text-[11px] text-ink-faint dark:bg-coal-line dark:text-coal-soft">
                    workspaces aren't set up on the server yet, this is a local default. apply the backend to enable private/shared and invites.
                  </p>
                )}

                {/* Backup, anyone can download their own copy of the data. */}
                <div className="mt-5 rounded-lg border border-paper-line p-3 dark:border-coal-line">
                  <div className="text-sm font-medium text-ink dark:text-coal-text">Back up this workspace</div>
                  <p className="mt-0.5 text-[11px] text-ink-faint dark:text-coal-soft">
                    a .zip with one JSON file per page and per table (the importable data, editable by hand or by an
                    AI, rules in its README.md) plus markdown/CSV previews. encrypted content is decrypted into the
                    file, so unlock first.
                  </p>
                  <button
                    type="button"
                    onClick={() => void runExport()}
                    disabled={exporting}
                    className="mt-2 flex items-center gap-1.5 rounded-md border border-paper-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-paper-panel disabled:opacity-50 dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
                  >
                    <Download className="h-3.5 w-3.5" /> {exporting ? 'building backup…' : 'download a backup'}
                  </button>

                  {/* Restore: recreate a backup into THIS workspace as new copies,
                      nothing existing is overwritten or deleted. */}
                  <div className="mt-3 border-t border-paper-line pt-3 dark:border-coal-line">
                    <div className="text-xs font-medium text-ink dark:text-coal-text">Restore from a backup</div>
                    <p className="mt-0.5 text-[11px] text-ink-faint dark:text-coal-soft">
                      drop a backup.zip, an old backup.json, or a single edited data/ file. pages, tables and rows
                      come back as fresh copies in this workspace, references reconnect (boards, views, maps and
                      automations too). nothing existing is changed or deleted.
                    </p>
                    <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-paper-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line">
                      <Upload className="h-3.5 w-3.5" /> {restoring ? 'restoring…' : 'restore a backup'}
                      <input
                        type="file"
                        accept=".zip,.json,application/zip,application/json"
                        disabled={restoring}
                        onChange={(e) => {
                          void runRestore(e.target.files?.[0]);
                          e.currentTarget.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* Import from a Notion export (.zip). Creates a workspace per top
                    folder and keeps the subpage tree; databases become tables. */}
                <div className="mt-5 rounded-lg border border-paper-line p-3 dark:border-coal-line">
                  <div className="text-sm font-medium text-ink dark:text-coal-text">Import from Notion</div>
                  <p className="mt-0.5 text-[11px] text-ink-faint dark:text-coal-soft">
                    export your Notion workspace as Markdown &amp; CSV, then drop the .zip here. each top-level space
                    becomes a workspace, subpages keep their nesting, and databases come in as tables. images aren't
                    imported yet.
                  </p>
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-paper-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line">
                    <Upload className="h-3.5 w-3.5" /> {importingNotion ? 'importing…' : 'upload a Notion .zip'}
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      disabled={importingNotion}
                      onChange={(e) => {
                        void runNotionImport(e.target.files?.[0]);
                        e.currentTarget.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Stored files: orphans left behind by page removals, plus anything
                    a member sent to the trash. Renders nothing for a non-admin. */}
                <div className="mt-5">
                  <FileTrashPanel />
                </div>

                {/* Danger zone, only the owner can delete (matches the server rule). */}
                {amOwner && (
                  <div className="mt-5 rounded-lg border border-red-300/60 p-3 dark:border-red-900/50">
                    <div className="text-sm font-medium text-red-600 dark:text-red-400">Delete this workspace</div>
                    <p className="mt-0.5 text-[11px] text-ink-faint dark:text-coal-soft">
                      removes the workspace for everyone. its pages stop being reachable. this can't be undone.
                    </p>
                    {confirmDelete ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-ink-soft dark:text-coal-soft">delete “{active?.name || 'this workspace'}”?</span>
                        <button
                          type="button"
                          onClick={() => void runDelete()}
                          className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> yes, delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          className="rounded-md border border-paper-line px-2.5 py-1 text-xs text-ink-soft hover:bg-paper-panel dark:border-coal-line dark:text-coal-soft dark:hover:bg-coal-line"
                        >
                          cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="mt-2 flex items-center gap-1.5 rounded-md border border-red-300/60 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> delete workspace
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                {/* Invite (admins only, and only with a real workspace) */}
                {amAdmin && !usingDefault && (
                  <div className="border-b border-paper-line px-4 py-3 dark:border-coal-line">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-paper-line px-2 py-1.5 focus-within:border-clay dark:border-coal-line">
                        <Mail className="h-3.5 w-3.5 text-ink-faint" />
                        <input
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            setErr(null);
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && void submitInvite()}
                          placeholder="invite by email"
                          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint/70 dark:text-coal-text"
                        />
                      </div>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                        className="rounded-lg border border-paper-line bg-paper px-2 py-1.5 text-sm text-ink dark:border-coal-line dark:bg-coal dark:text-coal-text"
                      >
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                        <option value="admin">admin</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void submitInvite()}
                        disabled={sending}
                        className="rounded-lg bg-clay px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-soft disabled:opacity-50"
                      >
                        invite
                      </button>
                    </div>
                    {err && <p className="mt-1.5 text-xs text-red-500">{err}</p>}
                    <p className="mt-1.5 text-[11px] text-ink-faint dark:text-coal-soft">
                      they join when they sign in with that email. there's no user list to browse.
                    </p>
                  </div>
                )}

                <div className="p-2">
                  {/* Your own key fingerprint, so co-members can verify they hold the
                      real one for you. */}
                  {!usingDefault && myFingerprint && (
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-paper-line bg-paper-panel/40 px-2.5 py-2 dark:border-coal-line dark:bg-coal-line/30">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ochre dark:text-ochre-soft" />
                      <span className="text-xs text-ink-soft dark:text-coal-soft">Your key</span>
                      <span className="font-mono text-[11px] tracking-tight text-ink dark:text-coal-text">{myFingerprint}</span>
                      <span className="w-full text-[11px] text-ink-faint dark:text-coal-soft">Read this to a member to confirm your device isn't being impersonated.</span>
                    </div>
                  )}
                  {usingDefault
                    ? roster.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 rounded-lg px-2.5 py-2">
                          <Avatar name={r.name} online={isOnline(r.id)} />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">
                            {r.name}
                            {r.id === me?.id ? ' (you)' : ''}
                          </span>
                        </div>
                      ))
                    : members.map((m) => {
                        const lastAdmin = m.role === 'admin' && adminCount <= 1;
                        const isMe = m.user === me?.id;
                        const fp = fingerprints[m.user];
                        const trust = keyTrust[m.user];
                        const changed = !isMe && trust === 'changed';
                        return (
                          <div key={m.id} className="rounded-lg px-2.5 py-2">
                            <div className="flex items-center gap-3">
                              <Avatar name={m.userName} online={isOnline(m.user)} />
                              <span className="min-w-0 flex-1 truncate text-sm text-ink dark:text-coal-text">
                                {m.userName}
                                {isMe ? ' (you)' : ''}
                              </span>
                              {amAdmin ? (
                                <>
                                  <select
                                    value={m.role}
                                    disabled={lastAdmin}
                                    onChange={(e) => void setMemberRole(m.id, e.target.value as WorkspaceRole)}
                                    className="rounded-md border border-paper-line bg-paper px-1.5 py-1 text-xs text-ink-soft disabled:opacity-50 dark:border-coal-line dark:bg-coal dark:text-coal-soft"
                                    title={lastAdmin ? 'a workspace needs at least one admin' : 'change role'}
                                  >
                                    <option value="admin">admin</option>
                                    <option value="editor">editor</option>
                                    <option value="viewer">viewer</option>
                                  </select>
                                  <button
                                    type="button"
                                    disabled={lastAdmin}
                                    onClick={() => void removeMember(m.id)}
                                    className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-red-500 disabled:opacity-40 dark:hover:bg-coal-line"
                                    title={lastAdmin ? "can't remove the last admin" : 'remove'}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              ) : (
                                <RoleBadge role={m.role} />
                              )}
                            </div>
                            {/* Key fingerprint + trust. Compare it out of band; a
                                changed key blocks sharing until re-verified. */}
                            {fp && (
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-11">
                                {changed ? (
                                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-500" />
                                ) : (
                                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-ochre dark:text-ochre-soft" />
                                )}
                                <span
                                  className={`font-mono text-[11px] tracking-tight ${changed ? 'text-red-500' : 'text-ink-faint dark:text-coal-soft'}`}
                                  title="This member's encryption key fingerprint. Read it to each other to verify."
                                >
                                  {fp}
                                </span>
                                {changed && (
                                  <>
                                    <span className="text-[11px] font-medium text-red-500">key changed</span>
                                    <button
                                      type="button"
                                      onClick={() => m.publicKey && verifyMemberKey(m.user, m.publicKey)}
                                      className="rounded-md border border-red-300 px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
                                      title="Only after you've confirmed the new fingerprint with them out of band"
                                    >
                                      verify &amp; trust
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                  {/* Pending invites */}
                  {invites.map((i) => (
                    <div key={i.id} className="flex items-center gap-3 rounded-lg px-2.5 py-2 opacity-80">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-panel text-ink-faint dark:bg-coal-line dark:text-coal-soft">
                        <Clock className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-soft dark:text-coal-soft">{i.email}</span>
                      <span className="text-xs text-ink-faint dark:text-coal-soft">invited · {i.role}</span>
                      {amAdmin && (
                        <button
                          type="button"
                          onClick={() => void cancelInvite(i.id)}
                          className="rounded p-1 text-ink-faint hover:bg-paper-panel hover:text-red-500 dark:hover:bg-coal-line"
                          title="cancel invite"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Canonical on=right / off=left switch. The knob is a flex child translated
// rightward when on, so there's no absolute-positioning ambiguity about which
// way it slides.
function Switch({ on, disabled, onToggle, title }: { on: boolean; disabled?: boolean; onToggle: () => void; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      title={title}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-50',
        on ? 'bg-clay' : 'bg-paper-line dark:bg-coal-line',
      ].join(' ')}
    >
      <span
        className={[
          'h-4 w-4 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

function Avatar({ name, online }: { name: string; online: boolean }) {
  return (
    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-clay/15 text-xs font-semibold text-clay">
      {name.slice(0, 1).toUpperCase()}
      <span
        className={[
          'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-paper dark:border-coal-panel',
          online ? 'bg-emerald-500' : 'bg-ink-faint/40 dark:bg-coal-soft/40',
        ].join(' ')}
      />
    </span>
  );
}

function RoleBadge({ role }: { role: WorkspaceRole }) {
  const { icon: Icon, label } = ROLE_META[role];
  return (
    <span className="flex items-center gap-1 text-xs text-ink-faint dark:text-coal-soft">
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}
