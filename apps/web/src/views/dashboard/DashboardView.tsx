import type { MyGroup, Workspace } from "@singulary/shared";
import {
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  Infinity as InfinityIcon,
  Lock,
  Plus,
  Settings,
  Sparkles,
  UserPlus,
  Users
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Textarea,TextInput } from "@/components/ui/FormField";
import { useDashboard } from "@/hooks/useDashboard";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { errorMessage } from "@/utils/forms";

type Tab = "workspaces" | "members" | "settings";

export function DashboardPage() {
  const navigate = useNavigate();
  const { myGroups: groups, error: dashboardError } = useDashboard();
  const { createWorkspace, error: workspacesError, setError } = useWorkspaces();

  const [activeGroupId, setActiveGroupId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("workspaces");
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const activeGroup = useMemo<MyGroup | undefined>(
    () => groups.find((group) => group.id === activeGroupId) ?? groups[0],
    [activeGroupId, groups]
  );

  useEffect(() => {
    if (!activeGroupId && groups[0]) {
      setActiveGroupId(groups[0].id);
    }
  }, [activeGroupId, groups]);

  useEffect(() => {
    if (activeGroup?.isUserGroup && tab === "members") {
      setTab("workspaces");
    }
  }, [activeGroup, tab]);

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const workspace = await createWorkspace({
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "")
      });
      form.reset();
      setCreating(false);
      navigate(`/workspaces/${workspace.id}`);
    } catch (requestError) {
      setLocalError(errorMessage(requestError, "فشل إنشاء مساحة العمل."));
    }
  }

  const error = dashboardError ?? workspacesError ?? localError;

  return (
    <div>
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <GroupSwitcher
            groups={groups}
            activeId={activeGroup?.id ?? null}
            onSelect={(id) => {
              setActiveGroupId(id);
              setTab("workspaces");
            }}
          />
          {activeGroup ? <GroupLimitsRow group={activeGroup} /> : null}
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <Sparkles size={14} className="text-accent" />
          <span className="text-xs uppercase tracking-tightish text-muted">
            { /* Todo: Place something here */}
          </span>
        </div>
      </div>

      {activeGroup ? (
        <div className="mb-7">
          <h1 className="text-3xl font-semibold tracking-tighter2 text-ink">
            {activeGroup.isUserGroup ? "المساحة الشخصية" : activeGroup.name}
          </h1>
          {activeGroup.description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted">{activeGroup.description}</p>
          ) : (
            <p className="mt-2 max-w-2xl text-sm text-muted">
              {activeGroup.isUserGroup
                ? "مساحتك الخاصة — لك وحدك حق الوصول. ابنِ، التقط لقطات، وشغّل المشاريع بمفاتيحك الخاصة."
                : "مجموعة مساحة عمل مشتركة لفريقك."}
            </p>
          )}
        </div>
      ) : null}

      <div className="mb-6 flex items-center justify-between border-b border-hairline">
        <div className="flex items-center gap-1">
          <TabButton active={tab === "workspaces"} onClick={() => setTab("workspaces")}>
            <Boxes size={14} />
            <span>مساحات العمل</span>
            {activeGroup ? (
              <span className="ml-1 rounded-full bg-elevated px-1.5 text-[10px] font-semibold text-muted">
                {activeGroup.workspaces.length}
              </span>
            ) : null}
          </TabButton>
          {!activeGroup?.isUserGroup ? (
            <TabButton active={tab === "members"} onClick={() => setTab("members")}>
              <Users size={14} />
              <span>الأعضاء</span>
              <span className="ml-1 rounded-full bg-elevated px-1.5 text-[10px] font-semibold text-muted">
                {activeGroup?.memberCount ?? 0}
              </span>
            </TabButton>
          ) : null}
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
            <Settings size={14} />
            <span>الإعدادات</span>
          </TabButton>
        </div>
      </div>

      {error ? (
        <div className="mb-5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {tab === "workspaces" && activeGroup ? (
        <WorkspacesTab
          group={activeGroup}
          creating={creating}
          onStartCreate={() => setCreating(true)}
          onCancelCreate={() => {
            setCreating(false);
            setLocalError(null);
          }}
          onCreate={handleCreateWorkspace}
          onOpen={(workspace) => navigate(`/workspaces/${workspace.id}`)}
        />
      ) : null}

      {tab === "members" && activeGroup ? <MembersTab group={activeGroup} /> : null}

      {tab === "settings" && activeGroup ? <GroupSettingsTab group={activeGroup} /> : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring relative -mb-px inline-flex h-10 items-center gap-2 px-3 text-sm font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"
        }`}
    >
      {children}
      {active ? (
        <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent" />
      ) : null}
    </button>
  );
}

function GroupSwitcher({
  groups,
  activeId,
  onSelect
}: {
  groups: MyGroup[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const active = groups.find((group) => group.id === activeId) ?? groups[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="focus-ring inline-flex h-10 items-center gap-2.5 rounded-lg border border-line bg-elevated px-3 transition-colors hover:border-line2"
      >
        <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-pink-500 to-pink-700">
          {active?.isUserGroup ? (
            <Lock size={12} className="text-white" />
          ) : (
            <span className="text-[10px] font-semibold text-white">
              {(active?.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <span className="text-sm font-medium tracking-tightish text-ink">
          {active ? (active.isUserGroup ? "المساحة الشخصية" : active.name) : "اختر مجموعة"}
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open ? (
        <div className="absolute left-0 top-12 z-30 w-72 overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl shadow-black/40">
          <div className="border-b border-hairline px-3 py-2 text-[10px] font-semibold tracking-tighter2 text-dim">
            مجموعاتك
          </div>
          <div className="grid gap-0.5 p-1">
            {groups.map((group) => {
              const isActive = group.id === activeId;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    onSelect(group.id);
                    setOpen(false);
                  }}
                  className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${isActive ? "bg-raised text-ink" : "text-muted hover:bg-raised hover:text-ink"
                    }`}
                >
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-pink-500 to-pink-700">
                    {group.isUserGroup ? (
                      <Lock size={11} className="text-white" />
                    ) : (
                      <span className="text-[10px] font-semibold text-white">
                        {group.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {group.isUserGroup ? "المساحة الشخصية" : group.name}
                    </div>
                    <div className="truncate text-[11px] text-dim">
                      {group.workspaces.length} مساحة عمل ·{" "}
                      {group.groupRole === "group_admin" ? "مسؤول" : "عضو"}
                    </div>
                  </div>
                  {isActive ? <Check size={14} className="text-accent" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GroupLimitsRow({ group }: { group: MyGroup }) {
  return (
    <div className="hidden h-10 items-center gap-3 rounded-lg border border-hairline bg-surface px-3 text-xs text-muted md:flex">
      <Pill
        label="مساحات العمل"
        value={
          group.limits.maxWorkspaces == null
            ? `${group.workspaces.length} / ∞`
            : `${group.workspaces.length} / ${group.limits.maxWorkspaces}`
        }
        warn={group.limits.maxWorkspaces != null && group.workspaces.length >= group.limits.maxWorkspaces}
      />
      <span className="h-3 w-px bg-line" />
      <Pill
        label="المشاريع"
        value={group.limits.maxProjectsPerWorkspace == null ? "∞" : String(group.limits.maxProjectsPerWorkspace)}
      />
      <span className="h-3 w-px bg-line" />
      <span className="text-[10px] tracking-tighter2 text-dim">
        {group.groupRole === "group_admin" ? "مسؤول" : "عضو"}
      </span>
    </div>
  );
}

function Pill({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-tighter2 text-dim">{label}</span>
      <span className={`text-xs font-medium ${warn ? "text-accent" : "text-ink"}`}>{value}</span>
    </span>
  );
}

function WorkspacesTab({
  group,
  creating,
  onStartCreate,
  onCancelCreate,
  onCreate,
  onOpen
}: {
  group: MyGroup;
  creating: boolean;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onOpen: (workspace: Workspace) => void;
}) {
  const atLimit =
    group.limits.maxWorkspaces != null && group.workspaces.length >= group.limits.maxWorkspaces;

  if (creating) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <h2 className="text-base font-semibold tracking-tightish text-ink">مساحة عمل جديدة</h2>
        <p className="mt-1 text-sm text-muted">تحتوي مساحة العمل على المشاريع والخدمات واللقطات وجلسات الوكيل.</p>
        <form className="mt-5 grid gap-4" onSubmit={onCreate}>
          <TextInput label="الاسم" name="name" placeholder="تحليلات SaaS" required autoFocus />
          <Textarea label="الوصف" name="description" placeholder="الغرض من هذه مساحة العمل" />
          <div className="flex items-center gap-2">
            <Button type="submit" icon={<Plus size={15} />}>
              إنشاء مساحة العمل
            </Button>
            <Button type="button" variant="ghost" onClick={onCancelCreate}>
              إلغاء
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <NewWorkspaceCard onClick={onStartCreate} disabled={atLimit} />
      {group.workspaces.map((workspace) => (
        <WorkspaceCard key={workspace.id} workspace={workspace} onClick={() => onOpen(workspace)} />
      ))}
      {group.workspaces.length === 0 ? (
        <div className="md:col-span-1 xl:col-span-2">
          <EmptyWorkspaceHint />
        </div>
      ) : null}
    </div>
  );
}

function NewWorkspaceCard({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-ring group relative flex h-44 flex-col items-start justify-between rounded-xl border border-dashed border-line bg-surface p-5 text-left transition-all hover:border-accent/50 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-elevated text-muted transition-colors group-hover:border-accent/60 group-hover:bg-accentSoft group-hover:text-accent">
        <Plus size={18} />
      </div>
      <div>
        <div className="text-sm font-semibold tracking-tightish text-ink">مساحة عمل جديدة</div>
        <div className="mt-1 text-xs text-muted">
          {disabled ? "تم الوصول لحد مساحات العمل." : "ابدأ قاعدة كود أو حزمة جديدة."}
        </div>
      </div>
    </button>
  );
}

function WorkspaceCard({ workspace, onClick }: { workspace: Workspace; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring group relative flex h-44 flex-col justify-between rounded-xl border border-hairline bg-surface p-5 text-left transition-all hover:-translate-y-0.5 hover:border-line2 hover:bg-elevated"
    >
      <div className="flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-elevated">
          <Boxes size={18} className="text-accent" />
        </div>
        <ArrowUpRight size={16} className="text-dim transition-colors group-hover:text-ink" />
      </div>
      <div>
        <div className="truncate text-base font-semibold tracking-tightish text-ink">{workspace.name}</div>
        <div className="mt-1 truncate text-xs text-muted">{workspace.slug}</div>
        {workspace.description ? (
          <div className="mt-2 line-clamp-1 text-xs text-dim">{workspace.description}</div>
        ) : null}
      </div>
    </button>
  );
}

function EmptyWorkspaceHint() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-5 text-sm text-muted">
      لا توجد مساحات عمل بعد. أنشئ أول واحدة للبدء.
    </div>
  );
}

function MembersTab({ group }: { group: MyGroup }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tightish text-ink">الأعضاء</h2>
          <p className="mt-1 text-sm text-muted">
            {group.memberCount} عضو في هذه المجموعة.
          </p>
        </div>
        {group.groupRole === "group_admin" ? (
          <Button icon={<UserPlus size={15} />} variant="secondary">
            دعوة عضو
          </Button>
        ) : null}
      </div>
      <div className="mt-6 grid place-items-center rounded-lg border border-dashed border-line bg-bg/30 p-10 text-center">
        <Users size={20} className="text-dim" />
        <div className="mt-3 text-sm text-muted">توجد واجهة إدارة الأعضاء هنا.</div>
        <div className="mt-1 text-xs text-dim">اربطها بـ /api/groups/:id/members.</div>
      </div>
    </div>
  );
}

function GroupSettingsTab({ group }: { group: MyGroup }) {
  const isAdmin = group.groupRole === "group_admin";

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-hairline bg-surface p-6">
        <h2 className="text-base font-semibold tracking-tightish text-ink">المجموعة</h2>
        <p className="mt-1 text-sm text-muted">الهوية والوصف.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <TextInput
            label="الاسم"
            defaultValue={group.isUserGroup ? "المساحة الشخصية" : group.name}
            readOnly={group.isUserGroup}
            disabled={!isAdmin || group.isUserGroup}
          />
          <TextInput label="المعرّف" defaultValue={group.id} readOnly disabled />
        </div>
        <div className="mt-4">
          <Textarea
            label="الوصف"
            defaultValue={group.description ?? ""}
            placeholder="ما هو الغرض من هذه المجموعة؟"
            disabled={!isAdmin || group.isUserGroup}
          />
        </div>
        {isAdmin && !group.isUserGroup ? (
          <div className="mt-5 flex justify-end">
            <Button>حفظ التغييرات</Button>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-hairline bg-surface p-6">
        <h2 className="text-base font-semibold tracking-tightish text-ink">الحدود</h2>
        <p className="mt-1 text-sm text-muted">الحدود المطبقة على هذه المجموعة من مسؤولي المنصة.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <LimitCard
            label="أقصى مساحات عمل"
            value={group.limits.maxWorkspaces}
            current={group.workspaces.length}
          />
          <LimitCard
            label="أقصى مشاريع / مساحة عمل"
            value={group.limits.maxProjectsPerWorkspace}
          />
        </div>
      </div>
    </div>
  );
}

function LimitCard({
  label,
  value,
  current
}: {
  label: string;
  value: number | null;
  current?: number;
}) {
  return (
    <div className="rounded-lg border border-line bg-elevated p-4">
      <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-dim">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        {value == null ? (
          <span className="inline-flex items-center gap-1 text-2xl font-semibold tracking-tighter2 text-ink">
            <InfinityIcon size={20} className="text-accent" />
            <span className="text-sm text-muted">غير محدود</span>
          </span>
        ) : (
          <>
            <span className="text-2xl font-semibold tracking-tighter2 text-ink">{value}</span>
            {current != null ? <span className="text-xs text-dim">مستخدم {current}</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
