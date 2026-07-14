"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BellRing,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  PlayCircle,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DisclaimerFooter } from "@/components/disclaimer";
import { AlertWatcher } from "@/components/alert-watcher";
import { StatusDot } from "@/components/workflow-status";
import { api } from "@/lib/api";
import { useAlerts, useHealth, useMe, useValidations, usePermissions } from "@/lib/hooks";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles autorises a VOIR l'entree. Le backend applique la regle de toute facon. */
  roles: Role[];
  /** Cle de pastille de comptage. */
  badge?: "validations" | "alerts";
};

const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Tableau de bord",
    icon: LayoutDashboard,
    roles: ["operator", "supervisor", "admin"],
  },
  {
    href: "/simulation",
    label: "Simulation",
    icon: PlayCircle,
    roles: ["operator", "supervisor", "admin"],
  },
  {
    href: "/plans",
    label: "Plans & validation",
    icon: ListChecks,
    roles: ["operator", "supervisor", "admin"],
    badge: "validations",
  },
  {
    href: "/decisions",
    label: "Decisions",
    icon: ShieldCheck,
    roles: ["operator", "supervisor", "admin"],
  },
  {
    href: "/alertes",
    label: "Alertes",
    icon: BellRing,
    roles: ["operator", "supervisor", "admin"],
    badge: "alerts",
  },
  {
    href: "/rapports",
    label: "Rapports",
    icon: FileBarChart,
    roles: ["operator", "supervisor", "admin"],
  },
  {
    href: "/journal",
    label: "Journal d'audit",
    icon: ClipboardList,
    roles: ["operator", "supervisor", "admin"],
  },
  {
    href: "/admin",
    label: "Administration",
    icon: Settings,
    roles: ["admin"],
  },
];

function GlobalHealthPill() {
  const { health, error } = useHealth();

  if (error || !health) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/[0.08] px-2.5 py-1 text-xs text-amber-200">
        <StatusDot status="down" />
        Sante inconnue
      </span>
    );
  }

  const statuses = Object.values(health.workflows).map((w) => w?.status ?? "down");
  const down = statuses.filter((s) => s === "down").length;
  const degraded = statuses.filter((s) => s === "degraded").length;

  const overall = down > 0 ? "down" : degraded > 0 ? "degraded" : "up";
  const text =
    overall === "up"
      ? "4/4 workflows operationnels"
      : overall === "degraded"
        ? `${degraded} workflow(s) degrade(s)`
        : `${down} workflow(s) injoignable(s)`;

  return (
    <Link
      href="/dashboard"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        overall === "up"
          ? "border-ok/30 bg-ok/[0.08] text-emerald-200 hover:bg-ok/[0.14]"
          : overall === "degraded"
            ? "border-warn/30 bg-warn/[0.08] text-amber-200 hover:bg-warn/[0.14]"
            : "border-danger/30 bg-danger/[0.08] text-red-200 hover:bg-danger/[0.14]",
      )}
    >
      <StatusDot status={overall} pulse />
      <span className="hidden sm:inline">{text}</span>
      <span className="sm:hidden">{overall === "up" ? "4/4" : "!"}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading } = useMe();
  const { role } = usePermissions();
  const { validations } = useValidations();
  const { alerts } = useAlerts();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  // Fermer le tiroir mobile a chaque navigation.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const pendingValidations = validations?.length ?? 0;
  const openAlerts = alerts?.filter((a) => !a.acknowledged_at).length ?? 0;

  const badgeCount = (item: NavItem): number => {
    if (item.badge === "validations") return role === "operator" ? 0 : pendingValidations;
    if (item.badge === "alerts") return openAlerts;
    return 0;
  };

  const visibleNav = NAV.filter((item) => (role ? item.roles.includes(role) : false));

  const logout = async () => {
    setLoggingOut(true);
    try {
      await api.auth.logout();
    } catch {
      // Meme si l'appel echoue, on renvoie l'utilisateur vers /login.
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  const nav = (
    <nav aria-label="Navigation principale" className="flex-1 space-y-1 px-3">
      {visibleNav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const count = badgeCount(item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-base-900",
              active
                ? "bg-emerald-500/12 font-medium text-emerald-200"
                : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "text-emerald-400" : "text-muted-foreground/70",
                )}
                aria-hidden="true"
              />
              <span className="truncate">{item.label}</span>
            </span>
            {count > 0 ? (
              <Badge
                variant={item.badge === "alerts" ? "warning" : "default"}
                className="px-1.5 py-0 text-[10px]"
              >
                <span className="sr-only">
                  {item.badge === "alerts" ? "alertes non acquittees : " : "en attente : "}
                </span>
                {count}
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#contenu" className="skip-link">
        Aller au contenu principal
      </a>

      <AlertWatcher />

      <div className="flex flex-1">
        {/* -------------------------------------------------- barre laterale */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/[0.07] bg-base-900/95 backdrop-blur-md transition-transform lg:static lg:translate-x-0",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex h-16 items-center justify-between px-5">
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
                <Activity className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold text-foreground">GridBalance AI</span>
                <span className="block text-[11px] text-muted-foreground">Morocco</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] lg:hidden"
              aria-label="Fermer le menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Orchestrateur de flexibilite
            </p>
          </div>

          {nav}

          {/* Carte utilisateur */}
          <div className="border-t border-white/[0.07] p-3">
            {isLoading && !user ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            ) : user ? (
              <div className="rounded-lg bg-white/[0.03] p-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-300"
                    aria-hidden="true"
                  >
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Badge variant="neutral">{ROLE_LABELS[user.role]}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={logout}
                    loading={loggingOut}
                    aria-label="Se deconnecter"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Quitter
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Voile mobile */}
        {mobileOpen ? (
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        {/* ------------------------------------------------------ contenu */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-white/[0.07] bg-base-900/80 px-4 backdrop-blur-md sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-2 text-muted-foreground hover:bg-white/[0.06] lg:hidden"
              aria-label="Ouvrir le menu"
              aria-expanded={mobileOpen}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="ml-auto flex items-center gap-3">
              <GlobalHealthPill />
            </div>
          </header>

          <main id="contenu" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">{children}</div>
          </main>

          <DisclaimerFooter />
        </div>
      </div>
    </div>
  );
}

/** En-tete de page reutilisable. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
