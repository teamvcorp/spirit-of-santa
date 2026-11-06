/**
 * Wish-list point allocation, PURE (unit-tested; no database). User decision 2026-11-06:
 * new points fill the OLDEST unfunded item first, then the next; anything beyond every item's
 * need stays "available". Amounts are integer centipoints.
 */
export type ListItemFunding = { id: string; costCentipoints: number; fundedCentipoints: number };
export type AllocationStep = { id: string; take: number; complete: boolean };

/** `items` must be in age order (oldest first). */
export function planAllocation(available: number, items: ListItemFunding[]): { steps: AllocationStep[]; left: number } {
  if (!Number.isSafeInteger(available) || available < 0) throw new Error("available must be a non-negative integer");
  let left = available;
  const steps: AllocationStep[] = [];
  for (const it of items) {
    if (left <= 0) break;
    const need = it.costCentipoints - it.fundedCentipoints;
    if (need <= 0) continue;
    const take = Math.min(need, left);
    left -= take;
    steps.push({ id: it.id, take, complete: take === need });
  }
  return { steps, left };
}
