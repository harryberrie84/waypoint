import { useEffect, useRef } from 'react';
import { registerNavSource, type NavLanes } from '../lib/rowNav';

// Registers this view's visible order (board stages / calendar days) as a row
// drawer navigation source while mounted. RowDetail's arrow keys and header
// buttons read the registry (lib/rowNav.ts navTarget) to hop between rows
// without closing the drawer. The view passes a GETTER so lanes are computed
// fresh on each ask and the registration never churns on data changes.

export function useRowNavSource(getLanes: () => NavLanes, onOpen?: (rowId: string) => void) {
  const ref = useRef({ getLanes, onOpen });
  ref.current = { getLanes, onOpen };
  useEffect(
    () =>
      registerNavSource({
        getLanes: () => ref.current.getLanes(),
        onOpen: (rowId) => ref.current.onOpen?.(rowId),
      }),
    [],
  );
}
