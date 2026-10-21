"use client";

import type { ReactNode } from "react";
import { useCallback, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Bookmark, Compass, Grid2X2, LineChart, Sparkles } from "lucide-react";
import { MosaicBrand, MobileMenu, PresentationProvider, ViewSwitch } from "./primitives";
import "./studio-textiles-final.css";

const navigation = [
  { label: "Explore", icon: Grid2X2, href: "/" },
  { label: "Scenarios", icon: Compass, href: "/#scenario-workspace" },
  { label: "Insights", icon: LineChart, href: "/#insights-workspace" },
  { label: "Saved", icon: Bookmark, href: "/saved" },
];

const PREFERRED_VIEW_KEY = "mosaic:preferred-view:v1";
type PresentationView = "studio" | "canvas";

function isPresentationView(value: string | null): value is PresentationView {
  return value === "studio" || value === "canvas";
}

function readPreferredView(): PresentationView {
  if (typeof window === "undefined") return "studio";
  try {
    const stored = window.localStorage.getItem(PREFERRED_VIEW_KEY);
    return isPresentationView(stored) ? stored : "studio";
  } catch {
    return "studio";
  }
}

function subscribeToPreferredView(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const handleStorageChange = () => onChange();
  window.addEventListener("storage", handleStorageChange);
  window.addEventListener("mosaic:preferred-view-change", handleStorageChange);
  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener("mosaic:preferred-view-change", handleStorageChange);
  };
}

function subscribeToHash(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash() {
  if (typeof window === "undefined") return "main-content";
  return window.location.hash.slice(1) || "main-content";
}

function Navigation() {
  const pathname = usePathname();
  const activeSection = useSyncExternalStore(subscribeToHash, readHash, () => "main-content");
  return <nav aria-label="Primary navigation" className="grid gap-1">
    {navigation.map(({ label, icon: Icon, href }) => {
      const [path, hash] = href.split("#");
      const active = path === "/saved" ? pathname === "/saved" : pathname === "/" && activeSection === (hash || "main-content");
      return <a key={label} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-[var(--mosaic-radius-sm)] px-3 text-sm font-semibold transition-colors ${active ? "bg-[var(--mosaic-blue-wash)] text-[#163c70]" : "text-[var(--mosaic-muted)] hover:bg-[var(--mosaic-paper-deep)] hover:text-[var(--mosaic-ink)]"}`}><Icon aria-hidden className="size-[18px] stroke-[1.8]" />{label}</a>;
    })}
  </nav>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const view = useSyncExternalStore(subscribeToPreferredView, readPreferredView, (): PresentationView => "studio");
  const setView = useCallback((nextView: PresentationView) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PREFERRED_VIEW_KEY, nextView);
    } catch {
      // Keep the in-memory presentation API usable when storage is unavailable.
    }
    window.dispatchEvent(new Event("mosaic:preferred-view-change"));
  }, []);
  return <PresentationProvider value={{ view, setView }}><div className="relative min-h-dvh overflow-hidden bg-[var(--mosaic-ivory)]">
    <div className="mosaic-paper-texture absolute inset-0" aria-hidden="true" />
    {view === "studio" && <div className="mosaic-studio-fabric-layer" aria-hidden="true">
      <i className="mosaic-fabric mosaic-fabric-cobalt" />
      <i className="mosaic-fabric mosaic-fabric-ochre" />
      <i className="mosaic-fabric mosaic-fabric-forest" />
      <i className="mosaic-fabric mosaic-fabric-vermilion" />
      <i className="mosaic-fabric mosaic-fabric-right-ochre" />
    </div>}
    <div className="relative mx-auto grid min-h-dvh max-w-[1600px] lg:grid-cols-[282px_1fr]">
      <aside className="hidden border-r border-[var(--mosaic-line)] px-8 py-7 lg:flex lg:flex-col">
        <MosaicBrand />
        <div className="mt-10"><Navigation /></div>
        {view === "studio" && <p className="mosaic-sidebar-handwriting" aria-hidden="true">Different<br />places.<br />Different<br />possibilities.<span className="mosaic-sidebar-underline" /></p>}
        <div className="mt-auto border-t border-[var(--mosaic-line)] pt-5"><p className="flex items-center gap-2 text-xs font-semibold text-[var(--mosaic-muted)]"><Sparkles aria-hidden className="size-3.5 text-[var(--mosaic-vermilion)]" />Cultural decision simulator</p></div>
      </aside>
      <div className="min-w-0">
        <header className="relative flex h-[62px] items-center justify-between border-b border-[var(--mosaic-line)] px-4 sm:px-7 lg:px-8">
          <div className="lg:hidden"><MosaicBrand compact /></div>
          <div className="hidden items-center gap-3 text-sm text-[var(--mosaic-muted)] sm:flex"><span className="font-mono text-[10px] uppercase tracking-[0.16em]">Workspace</span><span aria-hidden>/</span><span className="font-semibold text-[var(--mosaic-ink)]">Cultural signal</span></div>
          <div className="ml-auto flex items-center gap-2 sm:gap-4"><ViewSwitch /><MobileMenu><Navigation /></MobileMenu></div>
        </header>
        <main id="main-content" className="relative px-4 py-6 sm:px-7 sm:py-7 lg:px-[30px] lg:py-7">{children}</main>
      </div>
    </div>
  </div></PresentationProvider>;
}
