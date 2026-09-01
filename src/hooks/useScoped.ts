import { useMemo } from 'react';
import { useData, selectWorkspacePages, selectWorkspaceTables } from '../store/useData';
import { useWorkspace } from '../store/useWorkspace';
import type { Page, TableData } from '../types';

// Workspace-scoped views of the store for pickers (flow/automation targets,
// relation columns, mindmap nodes, page links). Reaching across every workspace
// you're a member of is a bug, pickers should only offer the active workspace.

export function useWorkspacePages(): Record<string, Page> {
  const pages = useData((s) => s.pages);
  const activeId = useWorkspace((s) => s.activeWorkspaceId);
  const defaultId = useWorkspace((s) => s.defaultWorkspaceId);
  // Fall back to the default bucket if no workspace is active yet, never "show
  // everything" in a picker (that's the cross-workspace bleed bug).
  return useMemo(() => selectWorkspacePages(pages, activeId ?? defaultId, defaultId), [pages, activeId, defaultId]);
}

export function useWorkspaceTables(): TableData[] {
  const tables = useData((s) => s.tables);
  const activeId = useWorkspace((s) => s.activeWorkspaceId);
  const defaultId = useWorkspace((s) => s.defaultWorkspaceId);
  return useMemo(() => selectWorkspaceTables(tables, activeId ?? defaultId, defaultId), [tables, activeId, defaultId]);
}
