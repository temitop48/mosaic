"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Check, ChevronDown, CircleAlert, CircleDot, FileText, Menu, X } from "lucide-react";

type PresentationView = "studio" | "canvas";
type PresentationContextValue = { view: PresentationView; setView: (view: PresentationView) => void };
const PresentationContext = createContext<PresentationContextValue>({ view: "studio", setView: () => undefined });
export const PresentationProvider = PresentationContext.Provider;
export function usePresentationView() { return useContext(PresentationContext); }

export const STRATEGIC_INTERPRETATION_KEY = "mosaic:strategic-interpretation-default:v1";

export function readStrategicInterpretationDefault() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STRATEGIC_INTERPRETATION_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribeToStrategicInterpretationDefault(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  window.addEventListener("mosaic:strategic-interpretation-default-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("mosaic:strategic-interpretation-default-change", onChange);
  };
}

export function setStrategicInterpretationPreference(nextEnabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STRATEGIC_INTERPRETATION_KEY, String(nextEnabled));
  } catch {
    // Keep the preference usable when storage is unavailable.
  }
  window.dispatchEvent(new Event("mosaic:strategic-interpretation-default-change"));
}

export function useStrategicInterpretationPreference() {
  const enabled = useSyncExternalStore(subscribeToStrategicInterpretationDefault, readStrategicInterpretationDefault, () => false);
  return { enabled, setEnabled: useCallback((nextEnabled: boolean) => setStrategicInterpretationPreference(nextEnabled), []) };
}

type ButtonVariant = "solid" | "quiet" | "outline" | "accent";
const buttonStyles: Record<ButtonVariant, string> = {
  solid: "bg-[var(--mosaic-ink)] text-[var(--mosaic-paper)] hover:bg-[var(--mosaic-forest)]",
  quiet: "bg-transparent text-[var(--mosaic-ink)] hover:bg-[var(--mosaic-paper-deep)]",
  outline: "border border-[var(--mosaic-line)] bg-[var(--mosaic-paper)] text-[var(--mosaic-ink)] hover:border-[var(--mosaic-ink)]",
  accent: "bg-[var(--mosaic-cobalt)] text-white hover:bg-[#124a9d]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }>(function Button({ variant = "solid", className = "", children, ...props }, ref) {
  return <button ref={ref} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--mosaic-radius-pill)] px-5 text-sm font-semibold transition-colors duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`} {...props}>{children}</button>;
});

export function TextField({ label, hint, error, className = "", id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const inputId = id ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <div className={`grid gap-2 ${className}`}>
    <label className="text-sm font-semibold text-[var(--mosaic-ink)]" htmlFor={inputId}>{label}</label>
    <input id={inputId} className="min-h-11 rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] bg-[var(--mosaic-paper)] px-3 text-sm text-[var(--mosaic-ink)] placeholder:text-[var(--mosaic-muted)] transition-colors hover:border-[var(--mosaic-muted)] focus:border-[var(--mosaic-cobalt)] focus:outline-none" aria-invalid={Boolean(error)} aria-describedby={hint || error ? `${inputId}-description` : undefined} {...props} />
    {(hint || error) && <p id={`${inputId}-description`} className={`text-xs leading-5 ${error ? "text-[var(--mosaic-vermilion)]" : "text-[var(--mosaic-muted)]"}`}>{error ?? hint}</p>}
  </div>;
}

export function SelectControl({ label, options, hint, className = "", id, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: Array<{ label: string; value: string }>; hint?: string }) {
  const selectId = id ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <div className={`grid gap-2 ${className}`}>
    <label className="text-sm font-semibold text-[var(--mosaic-ink)]" htmlFor={selectId}>{label}</label>
    <div className="relative">
      <select id={selectId} className="min-h-11 w-full appearance-none rounded-[var(--mosaic-radius-sm)] border border-[var(--mosaic-line)] bg-[var(--mosaic-paper)] px-3 pr-10 text-sm text-[var(--mosaic-ink)] transition-colors hover:border-[var(--mosaic-muted)] focus:border-[var(--mosaic-cobalt)] focus:outline-none" {...props}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--mosaic-muted)]" />
    </div>
    {hint && <p className="text-xs leading-5 text-[var(--mosaic-muted)]">{hint}</p>}
  </div>;
}

export function Tabs({ tabs, initialTab = tabs[0]?.value, className = "" }: { tabs: Array<{ label: string; value: string }>; initialTab?: string; className?: string }) {
  const [active, setActive] = useState(initialTab);
  return <div className={`flex flex-wrap gap-1 rounded-[var(--mosaic-radius-pill)] border border-[var(--mosaic-line)] bg-[var(--mosaic-paper)] p-1 ${className}`} role="tablist" aria-label="Workspace sections">
    {tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={active === tab.value} className={`rounded-[var(--mosaic-radius-pill)] px-4 py-2 text-sm transition-colors ${active === tab.value ? "bg-[var(--mosaic-ink)] text-white" : "text-[var(--mosaic-muted)] hover:text-[var(--mosaic-ink)]"}`} onClick={() => setActive(tab.value)}>{tab.label}</button>)}
  </div>;
}

const statusStyles = {
  neutral: "bg-[var(--mosaic-paper-deep)] text-[var(--mosaic-ink)]",
  positive: "bg-[#d8e6d9] text-[var(--mosaic-forest)]",
  attention: "bg-[#f7e7bb] text-[#6f4b00]",
  alert: "bg-[#f4d2cc] text-[#8d2e1f]",
} as const;

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: keyof typeof statusStyles }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-[var(--mosaic-radius-pill)] px-2.5 py-1 text-xs font-semibold ${statusStyles[tone]}`}><CircleDot aria-hidden className="size-2.5" />{label}</span>;
}

export type EvidenceClassification = "verified-observation" | "interpretation" | "unverified-suggestion";
const evidenceStyles: Record<EvidenceClassification, { label: string; className: string; icon: ReactNode }> = {
  "verified-observation": { label: "Verified observation", className: "border-[var(--mosaic-forest)] bg-[#e2eee3] text-[var(--mosaic-forest)]", icon: <Check aria-hidden className="size-3.5" /> },
  interpretation: { label: "Interpretation", className: "border-[var(--mosaic-cobalt)] bg-[var(--mosaic-blue-wash)] text-[#164786]", icon: <CircleDot aria-hidden className="size-3.5" /> },
  "unverified-suggestion": { label: "Suggestion to validate", className: "border-[#9a6e08] bg-[#f8eac3] text-[#704f00]", icon: <CircleAlert aria-hidden className="size-3.5" /> },
};

export function EvidenceBadge({ classification }: { classification: EvidenceClassification }) {
  const style = evidenceStyles[classification];
  return <span className={`inline-flex items-center gap-1.5 rounded-[var(--mosaic-radius-pill)] border px-2.5 py-1 text-xs font-semibold ${style.className}`}>{style.icon}{style.label}</span>;
}

export function ProvenanceIndicator({ provider = "Qloo", detail = "Provider evidence" }: { provider?: string; detail?: string }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-[var(--mosaic-muted)]" title={detail}><FileText aria-hidden className="size-3.5" />{provider}<span className="sr-only">{detail}</span></span>;
}

export function Card({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <Tag className={`rounded-[var(--mosaic-radius-md)] border border-[rgb(120_93_58_/_0.2)] bg-[rgb(251_248_241_/_0.72)] shadow-[var(--mosaic-shadow-paper)] ${className}`}>{children}</Tag>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="grid place-items-center rounded-[var(--mosaic-radius-md)] border border-dashed border-[var(--mosaic-line)] bg-[rgb(251_248_241_/_0.56)] px-6 py-16 text-center">
    <div className="mb-4 grid size-12 place-items-center rounded-full bg-[var(--mosaic-blue-wash)] text-[var(--mosaic-cobalt)]"><CircleDot aria-hidden className="size-5" /></div>
    <h3 className="mosaic-serif text-2xl text-[var(--mosaic-ink)]">{title}</h3>
    <p className="mt-2 max-w-md text-sm leading-6 text-[var(--mosaic-muted)]">{description}</p>
    {action && <div className="mt-6">{action}</div>}
  </div>;
}

export function LoadingState({ label = "Preparing workspace" }: { label?: string }) {
  return <div className="grid gap-3" aria-live="polite" aria-busy="true"><div className="h-3 w-1/3 animate-pulse rounded bg-[var(--mosaic-paper-deep)]" /><div className="h-24 animate-pulse rounded-[var(--mosaic-radius-md)] bg-[var(--mosaic-paper-deep)]" /><span className="text-xs text-[var(--mosaic-muted)]">{label}</span></div>;
}

export function ErrorState({ title = "Something needs attention", description }: { title?: string; description: string }) {
  return <div role="alert" className="flex gap-3 rounded-[var(--mosaic-radius-md)] border border-[#d89b8f] bg-[#f9e2dd] p-4 text-[#79291e]"><CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" /><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-5">{description}</p></div></div>;
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="max-w-2xl">
      {eyebrow && <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--mosaic-cobalt)]">{eyebrow}</p>}
      <h2 className="mosaic-serif text-3xl leading-tight text-[var(--mosaic-ink)] sm:text-4xl">{title}</h2>
      {description && <p className="mt-3 text-sm leading-6 text-[var(--mosaic-muted)] sm:text-base">{description}</p>}
    </div>
    {action}
  </div>;
}

export function MosaicBrand({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return <a href="#main-content" className={`group inline-flex items-center ${compact ? "gap-2" : "gap-3"} ${className}`} aria-label="Mosaic home">
    <img src="/design-assets/logo/logo-mark.png" alt="" className={`block shrink-0 object-contain ${compact ? "h-8 w-9" : "h-11 w-14"}`} />
    <img src="/design-assets/logo/wordmark.png" alt="Mosaic" className={`block shrink-0 object-contain ${compact ? "h-5 w-[78px]" : "h-7 w-[112px]"}`} />
  </a>;
}

export function MobileMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);
  return <div className="lg:hidden">
    <Button ref={triggerRef} variant="quiet" className="size-11 px-0" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((value) => !value)}>{open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}</Button>
    {open && <div id={menuId} className="absolute inset-x-4 top-[4.5rem] z-20 rounded-[var(--mosaic-radius-md)] border border-[var(--mosaic-line)] bg-[var(--mosaic-paper)] p-3 shadow-[var(--mosaic-shadow-paper)]">{children}</div>}
  </div>;
}

export function ViewSwitch() {
  const { view, setView } = usePresentationView();
  return <div className="flex items-center gap-1 rounded-[var(--mosaic-radius-pill)] border border-[var(--mosaic-line)] bg-[var(--mosaic-paper)] p-1" role="tablist" aria-label="Presentation view">
    {(["studio", "canvas"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => setView(item)} className={`rounded-[var(--mosaic-radius-pill)] px-3 py-1.5 text-xs font-semibold transition-colors ${view === item ? "bg-[var(--mosaic-ink)] text-white" : "text-[var(--mosaic-muted)] hover:text-[var(--mosaic-ink)]"}`}>{item[0].toUpperCase() + item.slice(1)}</button>)}
  </div>;
}

export function ArrowLink({ children }: { children: ReactNode }) {
  return <a href="#main-content" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--mosaic-cobalt)] hover:text-[var(--mosaic-forest)]">{children}<ArrowRight aria-hidden className="size-4" /></a>;
}
