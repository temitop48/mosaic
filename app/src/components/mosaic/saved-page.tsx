"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Clock3 } from "lucide-react";
import { Button, Card, EmptyState } from "./primitives";
import { deleteSavedAnalysis, parseSavedAnalyses, readSavedAnalysesSnapshot, SAVED_ANALYSIS_HANDOFF_KEY, subscribeToSavedAnalyses, type SavedAnalysis } from "./saved-analyses";

function formatSavedDate(value: string) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return "Date unavailable"; }
}

export function SavedPage() {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribeToSavedAnalyses, readSavedAnalysesSnapshot, () => "[]");
  const entries = useMemo(() => parseSavedAnalyses(raw), [raw]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [message, setMessage] = useState<string>();

  function open(entry: SavedAnalysis) {
    try { window.sessionStorage.setItem(SAVED_ANALYSIS_HANDOFF_KEY, JSON.stringify([entry])); } catch { setMessage("This saved analysis could not be opened because browser session storage is unavailable."); return; }
    router.push("/");
  }

  function confirmDelete(id: string) {
    const outcome = deleteSavedAnalysis(id);
    if (outcome.ok) { setPendingDeleteId(undefined); setMessage("Saved analysis deleted."); }
    else setMessage(outcome.message);
  }

  return <div className="mx-auto max-w-5xl">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--mosaic-cobalt)]">Historical research</p><h1 className="mosaic-serif mt-2 text-4xl text-[var(--mosaic-ink)]">Saved research</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--mosaic-muted)]">Reopen validated provider observations without starting a new Qloo or Gemini request.</p></div><div className="flex items-center gap-2 text-xs text-[var(--mosaic-muted)]"><Bookmark aria-hidden className="size-4" />{entries.length} of 10 saved</div></div>
    {message && <p className="mt-5 text-sm text-[var(--mosaic-muted)]" role="status" aria-live="polite">{message}</p>}
    {entries.length === 0 ? <div className="mt-8"><EmptyState title="No saved analyses yet" description="Run an analysis from the workspace, then choose Save Analysis to keep its validated result in this browser." /></div> : <div className="mt-8 grid gap-4">{entries.map((entry) => <Card key={entry.id} as="article" className="p-5 sm:p-6"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><h2 className="truncate text-base font-semibold text-[var(--mosaic-ink)]">{entry.title}</h2><p className="mt-2 text-sm text-[var(--mosaic-ink)]"><span className="font-semibold">Signal:</span> {entry.request.seedQuery}</p><p className="mt-1 text-sm text-[var(--mosaic-muted)]">{entry.request.baselineLocation} <span aria-hidden>→</span> {entry.request.alternativeLocation}</p><p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--mosaic-muted)]"><Clock3 aria-hidden className="size-3.5" />Saved {formatSavedDate(entry.createdAt)}</p><p className="mt-3 text-xs leading-5 text-[var(--mosaic-muted)]">Historical provider observations; not current market data and not revalidated automatically.</p></div><div className="flex shrink-0 flex-wrap gap-2">{pendingDeleteId === entry.id ? <><Button type="button" variant="outline" onClick={() => confirmDelete(entry.id)}>Confirm delete</Button><Button type="button" variant="quiet" onClick={() => setPendingDeleteId(undefined)}>Cancel</Button></> : <><Button type="button" variant="accent" onClick={() => open(entry)}>Open research</Button><Button type="button" variant="quiet" onClick={() => { setPendingDeleteId(entry.id); setMessage(undefined); }}>Delete</Button></>}</div></div></Card>)}</div>}
  </div>;
}
