import { fetchFindings } from "./api";
import type { FindingsResponse } from "./api";
import { findingToDocketTask } from "./docket-types";
import type { DocketBill } from "./docket-types";

const STORAGE_KEY = "docket_bills";

export interface StoredBill {
  dvId: string;
  addedDate: string;
}

export function getStoredBills(): StoredBill[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addStoredBill(dvId: string): void {
  const bills = getStoredBills();
  if (bills.some((b) => b.dvId === dvId)) return;
  bills.push({ dvId, addedDate: new Date().toISOString().slice(0, 10) });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bills));
}

export function removeStoredBill(dvId: string): void {
  const bills = getStoredBills().filter((b) => b.dvId !== dvId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bills));
}

export function removeAllStoredBills(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
}

export function keepOnlyBills(dvIds: string[]): void {
  const keep = new Set(dvIds);
  const bills = getStoredBills().filter((b) => keep.has(b.dvId));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bills));
}

export async function loadBill(dvId: string): Promise<DocketBill | null> {
  try {
    const data: FindingsResponse = await fetchFindings(dvId);
    const identity = data.legalIdentity;
    const title = identity.shortTitle
      ?? (identity.chapter
        ? `Chapter ${identity.chapter}`
        : `${identity.instrumentType} ${identity.number}`);
    const number = identity.chapter
      ? `Chapter ${identity.chapter}`
      : `${identity.instrumentType} ${identity.number}`;

    const tasks = data.findings
      .filter((f) => f.anchored)
      .map((f) => findingToDocketTask(f, dvId, number));

    const stored = getStoredBills().find((b) => b.dvId === dvId);

    return {
      dvId,
      legalIdentity: identity,
      title,
      number,
      jurisdiction: identity.jurisdiction,
      session: identity.session,
      addedDate: stored?.addedDate ?? new Date().toISOString().slice(0, 10),
      tasks,
      coverage: data.coverage,
    };
  } catch {
    return null;
  }
}

export async function loadAllBills(): Promise<DocketBill[]> {
  const stored = getStoredBills();
  const results = await Promise.all(stored.map((b) => loadBill(b.dvId)));
  const loaded = results.filter((b): b is DocketBill => b !== null);

  const seen = new Map<string, DocketBill>();
  for (const bill of loaded) {
    const existing = seen.get(bill.number);
    if (!existing || bill.tasks.length > existing.tasks.length) {
      seen.set(bill.number, bill);
    }
  }
  return Array.from(seen.values());
}

export function formatBillTitle(bill: DocketBill): string {
  return bill.title;
}

export function formatBillNumber(bill: DocketBill): string {
  return bill.number;
}
