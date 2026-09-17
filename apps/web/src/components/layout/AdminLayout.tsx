import {
  Boxes,
  Brain,
  Gauge,
  KeyRound,
  Lock,
  LogOut,
  Server,
  Settings,
  ShieldCheck,
  SquareStack,
  Users,
  Wallet
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";

type AdminLayoutProps = {
  children: ReactNode;
};

const sections: Array<{
  title: string;
  items: Array<{ to: string; label: string; icon: ReactNode; end?: boolean }>;
}> = [
  {
    title: "المنصة",
    items: [
      { to: "/admin", label: "نظرة عامة", icon: <Gauge size={15} />, end: true },
      { to: "/admin/settings", label: "الإعدادات", icon: <Settings size={15} /> },
      { to: "/admin/docker", label: "دوكر", icon: <Server size={15} /> }
    ]
  },
  {
    title: "الوصول",
    items: [
      { to: "/admin/users", label: "المستخدمون", icon: <Users size={15} /> },
      { to: "/admin/groups", label: "المجموعات", icon: <SquareStack size={15} /> },
      { to: "/admin/workspaces", label: "مساحات العمل", icon: <Boxes size={15} /> },
      { to: "/admin/permissions", label: "الصلاحيات", icon: <Lock size={15} /> },
      { to: "/admin/rules", label: "قواعد المجموعة", icon: <ShieldCheck size={15} /> }
    ]
  },
  {
    title: "الذكاء الاصطناعي",
    items: [
      { to: "/admin/provider-keys", label: "المزودون", icon: <KeyRound size={15} /> },
      { to: "/admin/model-access", label: "وصول النماذج", icon: <Brain size={15} /> },
      { to: "/admin/quotas", label: "حصص الرموز", icon: <Wallet size={15} /> }
    ]
  }
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-hairline bg-surface lg:flex">
          <div className="flex h-14 items-center gap-2.5 border-b border-hairline px-5">
            <div className="grid h-7 w-7 place-items-center rounded-md border border-accent/40 bg-accentSoft text-accent">
              <ShieldCheck size={14} />
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold tracking-tightish text-ink">الإدارة</div>
              <div className="text-[10px] tracking-tighter2 text-dim">سنغولاري</div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-3">
            {sections.map((section) => (
              <div key={section.title} className="px-3 pb-4">
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-tighter2 text-dim">
                  {section.title}
                </div>
                <div className="grid gap-0.5">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
                          isActive
                            ? "bg-elevated text-ink"
                            : "text-muted hover:bg-elevated hover:text-ink"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className={isActive ? "text-accent" : "text-muted group-hover:text-ink"}>
                            {item.icon}
                          </span>
                          <span className="font-medium">{item.label}</span>
                          {isActive ? (
                            <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-hairline p-3">
            <Link
              to="/"
              className="focus-ring flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <LogOut size={15} className="rotate-180" />
              Back to dashboard
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-hairline bg-bg/85 px-6 backdrop-blur-xl">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-accent">Admin panel</div>
              <div className="text-xs text-muted">Platform configuration</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <div className="text-xs font-medium text-ink">{user?.displayName}</div>
                <div className="text-[10px] uppercase tracking-tighter2 text-dim">{user?.role}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-elevated px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <LogOut size={14} />
                تسجيل الخروج
              </button>
            </div>
          </header>

          <main className="flex-1 px-6 py-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
