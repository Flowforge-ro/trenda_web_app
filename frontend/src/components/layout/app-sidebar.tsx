import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Truck,
  ClipboardList,
  CalendarDays,
  Boxes,
  Users,
  BarChart3,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { apiFetch } from "@/lib/http";
import { useAuth } from "@/lib/auth";
import { logAction } from "@/lib/logger";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Comenzi", icon: ClipboardList, end: true },
  { to: "/programari", label: "Programări", icon: CalendarDays, end: false },
  { to: "/piese", label: "Piese", icon: Boxes, end: false },
  { to: "/clienti", label: "Clienți", icon: Users, end: false },
  { to: "/rapoarte", label: "Rapoarte", icon: BarChart3, end: false },
  { to: "/setari", label: "Setări", icon: Settings, end: false },
];

async function logout() {
  logAction("logout");
  await apiFetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export function AppSidebar() {
  const { data: user } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem("sidebar-collapsed") === "true"
  );
  const initial = (user?.name ?? user?.email ?? "U").charAt(0).toUpperCase();

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col bg-green-900 text-green-50 transition-[width] duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Brand + collapse toggle */}
      <div
        className={cn(
          "flex items-center py-5",
          collapsed ? "justify-center px-2" : "gap-2 px-4"
        )}
      >
        {!collapsed && (
          <>
            <Truck className="h-6 w-6 shrink-0" />
            <span className="flex-1 text-lg font-semibold tracking-tight">
              Trenda
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Extinde bara laterală" : "Restrânge bara laterală"}
          className="cursor-pointer rounded-md p-1.5 text-green-100/70 transition-colors hover:bg-green-800 hover:text-white"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5" />
          ) : (
            <PanelLeftClose className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                collapsed ? "justify-center" : "gap-3",
                isActive
                  ? "bg-green-950 text-white"
                  : "text-green-100/80 hover:bg-green-800 hover:text-white"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && label}
          </NavLink>
        ))}
      </nav>

      {/* Footer / user */}
      <div className="border-t border-green-800 px-3 py-3">
        <div
          className={cn(
            "flex items-center",
            collapsed ? "flex-col gap-2" : "gap-3 px-3"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-700 text-sm font-semibold text-white">
            {initial}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {user?.name ?? "Utilizator"}
              </p>
              <p className="truncate text-xs text-green-100/60">
                {user?.email ?? ""}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            aria-label="Deconectare"
            title={collapsed ? "Deconectare" : undefined}
            className="cursor-pointer rounded-md p-1.5 text-green-100/70 transition-colors hover:bg-green-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
