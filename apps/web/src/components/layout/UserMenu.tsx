import { ChevronDown, KeyRound, LogOut, Settings as SettingsIcon, ShieldCheck, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";

export function UserMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate("/login", { replace: true });
  }

  const initials = (user?.displayName || user?.username || "?")
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase())
    .join("")
    .slice(0, 2);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="focus-ring group flex h-9 items-center gap-2 rounded-full border border-line bg-elevated pl-1 pr-2.5 transition-colors hover:border-line2"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-pink-700 text-[11px] font-semibold text-white">
          {initials}
        </span>
        <span className="hidden text-sm font-medium text-ink sm:block">{user?.displayName}</span>
        <ChevronDown size={14} className="text-muted transition-transform group-hover:text-ink" />
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-30 w-64 overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl shadow-black/40">
          <div className="border-b border-hairline px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-pink-700 text-xs font-semibold text-white">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{user?.displayName}</div>
                <div className="truncate text-xs text-muted">{user?.email}</div>
              </div>
            </div>
          </div>
          <div className="grid gap-0.5 p-1">
            <MenuItem to="/settings" icon={<User size={15} />} label="الحساب" onClick={() => setOpen(false)} />
            <MenuItem to="/provider-keys" icon={<KeyRound size={15} />} label="مفاتيح المزود" onClick={() => setOpen(false)} />
            <MenuItem to="/settings" icon={<SettingsIcon size={15} />} label="الإعدادات" onClick={() => setOpen(false)} />
            {user?.role === "instance_admin" ? (
              <>
                <div className="my-1 h-px bg-hairline" />
                <MenuItem
                  to="/admin"
                  icon={<ShieldCheck size={15} className="text-accent" />}
                  label="لوحة الإدارة"
                  accent
                  onClick={() => setOpen(false)}
                />
              </>
            ) : null}
            <div className="my-1 h-px bg-hairline" />
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <LogOut size={15} />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  to,
  icon,
  label,
  accent = false,
  onClick
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors ${
        accent
          ? "text-accent hover:bg-accentSoft"
          : "text-muted hover:bg-raised hover:text-ink"
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
