import type {
  AdminSummary,
  AdminUser,
  DockerConfig,
  DockerConnectionCheck,
  Group,
  GroupConfig,
  GroupMember,
  GroupRole,
  PermissionPolicy,
  PlatformSettings,
  ProviderAccessPolicy,
  ProviderConfig,
  ProviderKey,
  ProviderModelOption,
  ProviderModelPolicy,
  TokenBudget,
  Workspace
} from "@singulary/shared";
import { Check } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { selectClass,Textarea, TextInput } from "@/components/ui/FormField";
import { Section } from "@/components/ui/Section";
import { Stat } from "@/components/ui/Stat";
import { adminService } from "@/services/admin.service";

export function AdminOverviewPage() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminService.summary()
      .then(setSummary)
      .catch((requestError) => setError(toMessage(requestError, "Failed to load admin overview.")));
  }, []);

  return (
    <AdminPage title="Overview" description="Platform-wide controls for this self-hosted instance." error={error}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Users" value={summary?.users ?? "—"} />
        <Stat label="Groups" value={summary?.groups ?? "—"} />
        <Stat label="Workspaces" value={summary?.workspaces ?? "—"} />
        <Stat label="Projects" value={summary?.projects ?? "—"} />
        <Stat label="Global keys" value={summary?.globalProviderKeys ?? "—"} />
        <Stat label="Providers" value={summary?.providerConfigs ?? "—"} />
        <Stat label="Token quotas" value={summary?.tokenBudgets ?? "—"} />
        <Stat label="Permission policies" value={summary?.permissionPolicies ?? "—"} />
      </div>
      <div className="mt-6 rounded-xl border border-hairline bg-surface p-5">
        <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-dim">Platform</div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>
            BYOK:{" "}
            <strong className={summary?.settings.byokEnabled ? "text-accent" : "text-ink"}>
              {summary?.settings.byokEnabled ? "enabled" : "disabled"}
            </strong>
          </span>
          <span className="text-faint">·</span>
          <span>
            Global keys:{" "}
            <strong className={summary?.settings.globalProviderKeysEnabled ? "text-accent" : "text-ink"}>
              {summary?.settings.globalProviderKeysEnabled ? "enabled" : "disabled"}
            </strong>
          </span>
          <span className="text-faint">·</span>
          <span>
            Approval gates:{" "}
            <strong className={summary?.settings.requireApprovalForDangerousTools ? "text-accent" : "text-ink"}>
              {summary?.settings.requireApprovalForDangerousTools ? "on" : "off"}
            </strong>
          </span>
        </div>
      </div>
    </AdminPage>
  );
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [userResponse, groupResponse] = await Promise.all([
      adminService.users(),
      adminService.groups()
    ]);
    setUsers(userResponse.users);
    setGroups(groupResponse.groups);
  }

  useEffect(() => {
    load().catch((requestError) => setError(toMessage(requestError, "Failed to load users.")));
  }, []);

  async function updateRole(userId: string, role: string) {
    setError(null);
    try {
      await adminService.updateUserRole(userId, role);
      await load();
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to update role."));
    }
  }

  async function addUserToGroup(userId: string, groupId: string) {
    if (!groupId) return;
    setError(null);
    try {
      await adminService.addGroupMember(groupId, { userId });
      await load();
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to add user to group."));
    }
  }

  return (
    <AdminPage title="Users" description="Manage employee access, roles, groups, and individual controls." error={error}>
      <div className="grid gap-3">
        {users.map((user) => {
          const availableGroups = groups.filter((group) => !user.groups.some((userGroup) => userGroup.id === group.id));

          return (
            <div key={user.id} className="rounded-xl border border-hairline bg-surface p-5">
              <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr_260px] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-base font-semibold tracking-tightish text-ink">{user.displayName}</div>
                    <RoleBadge role={user.role} />
                  </div>
                  <div className="mt-1 text-sm text-muted">{user.email}</div>
                  <div className="mt-1 font-mono text-[11px] text-dim">@{user.username}</div>
                </div>

                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-tighter2 text-dim">Groups</div>
                  <div className="flex flex-wrap gap-1.5">
                    {user.groups.length === 0 ? <span className="text-sm text-dim">No groups</span> : null}
                    {user.groups.map((group) => (
                      <span
                        key={group.id}
                        className="rounded-full border border-line bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink"
                      >
                        {group.name}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <select
                      className={selectClass}
                      defaultValue=""
                      onChange={(event) => {
                        void addUserToGroup(user.id, event.target.value);
                        event.currentTarget.value = "";
                      }}
                    >
                      <option value="">Add to group</option>
                      {availableGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
                  <span>Global role</span>
                  <select className={selectClass} value={user.role} onChange={(event) => void updateRole(user.id, event.target.value)}>
                    <option value="instance_admin">Instance Admin</option>
                    <option value="user">Developer</option>
                    <option value="readonly">Read-only</option>
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </AdminPage>
  );
}

export function AdminGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = useMemo(() => groups.find((group) => group.id === selectedGroupId) ?? groups[0], [groups, selectedGroupId]);

  async function load() {
    const [groupResponse, userResponse] = await Promise.all([
      adminService.groups(),
      adminService.users()
    ]);
    setGroups(groupResponse.groups);
    setUsers(userResponse.users);
    if (!selectedGroupId && groupResponse.groups[0]) {
      setSelectedGroupId(groupResponse.groups[0].id);
    }
  }

  async function loadMembers(groupId: string) {
    const response = await adminService.groupMembers(groupId);
    setMembers(response.members);
  }

  useEffect(() => {
    load().catch((requestError) => setError(toMessage(requestError, "Failed to load groups.")));
  }, []);

  useEffect(() => {
    if (selectedGroup?.id) {
      loadMembers(selectedGroup.id).catch((requestError) => setError(toMessage(requestError, "Failed to load group members.")));
    }
  }, [selectedGroup?.id]);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await adminService.createGroup({
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "")
      });
      form.reset();
      await load();
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to create group."));
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroup) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await adminService.addGroupMember(selectedGroup.id, {
        userId: String(formData.get("userId") ?? ""),
        role: (formData.get("role") as GroupRole) ?? "group_member"
      });
      await load();
      await loadMembers(selectedGroup.id);
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to add member."));
    }
  }

  async function updateMemberRole(userId: string, role: GroupRole) {
    if (!selectedGroup) return;
    try {
      await adminService.updateGroupMemberRole(selectedGroup.id, userId, role);
      await loadMembers(selectedGroup.id);
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to update role."));
    }
  }

  async function removeMember(userId: string) {
    if (!selectedGroup) return;
    await adminService.removeGroupMember(selectedGroup.id, userId);
    await load();
    await loadMembers(selectedGroup.id);
  }

  return (
    <AdminPage title="Groups" description="Create user groups and assign users for quotas and permission policies." error={error}>
      <Section title="Create group">
        <form className="grid gap-3 rounded-xl border border-hairline bg-surface p-5 md:grid-cols-[1fr_1fr_auto]" onSubmit={createGroup}>
          <TextInput label="Name" name="name" placeholder="AI Power Users" required />
          <Textarea label="Description" name="description" placeholder="Optional group purpose" />
          <div className="flex items-end">
            <Button type="submit" className="w-full md:w-auto">
              Create
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Membership">
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="rounded-xl border border-hairline bg-surface p-5">
            <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
              <span>Group</span>
              <select
                className={selectClass}
                value={selectedGroup?.id ?? ""}
                onChange={(event) => setSelectedGroupId(event.target.value)}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.isUserGroup ? "Personal space" : group.name} ({group.memberCount})
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-sm text-muted">{selectedGroup?.description ?? "No description."}</p>
            {selectedGroup?.isUserGroup ? (
              <div className="mt-3 rounded-lg border border-accent/20 bg-accentSoft px-3 py-2 text-xs text-accent">
                Personal spaces are immutable.
              </div>
            ) : null}
          </div>
          <div className="rounded-xl border border-hairline bg-surface p-5">
            {selectedGroup ? (
              <>
                {!selectedGroup.isUserGroup ? (
                  <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_160px_auto]" onSubmit={addMember}>
                    <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
                      <span>User</span>
                      <select name="userId" className={selectClass}>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
                      <span>Join as</span>
                      <select name="role" className={selectClass} defaultValue="group_member">
                        <option value="group_member">Member</option>
                        <option value="group_admin">Admin</option>
                      </select>
                    </label>
                    <div className="flex items-end">
                      <Button type="submit" className="w-full sm:w-auto">
                        Add
                      </Button>
                    </div>
                  </form>
                ) : null}
                <ul className="divide-y divide-hairline">
                  {members.map((member) => (
                    <li key={member.userId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-pink-700 text-[10px] font-semibold text-white">
                          {member.displayName.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <div className="text-sm font-medium text-ink">{member.displayName}</div>
                          <div className="text-xs text-muted">{member.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <SegmentedControl
                          options={[
                            { value: "group_member", label: "Member" },
                            { value: "group_admin", label: "Admin" }
                          ]}
                          value={member.groupRole}
                          disabled={selectedGroup.isUserGroup}
                          onChange={(value) => void updateMemberRole(member.userId, value as GroupRole)}
                        />
                        {!selectedGroup.isUserGroup ? (
                          <Button variant="ghost" size="sm" onClick={() => void removeMember(member.userId)}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-sm text-muted">Create a group first.</div>
            )}
          </div>
        </div>
      </Section>
    </AdminPage>
  );
}

export function AdminWorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminService.workspaces()
      .then((response) => setWorkspaces(response.workspaces))
      .catch((requestError) => setError(toMessage(requestError, "Failed to load workspaces.")));
  }, []);

  return (
    <AdminPage title="Workspaces" description="Review all workspace records across the instance." error={error}>
      <div className="grid gap-3 lg:grid-cols-2">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="rounded-xl border border-hairline bg-surface p-5">
            <div className="font-semibold tracking-tightish text-ink">{workspace.name}</div>
            <div className="mt-0.5 font-mono text-[11px] text-dim">{workspace.slug}</div>
            <p className="mt-3 text-sm text-muted">{workspace.description ?? "No description."}</p>
          </div>
        ))}
      </div>
    </AdminPage>
  );
}

export function AdminProviderKeysPage() {
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [keyResponse, providerResponse] = await Promise.all([
      adminService.providerKeys(),
      adminService.providers()
    ]);
    setKeys(keyResponse.providerKeys);
    setProviders(providerResponse.providers);
  }

  useEffect(() => {
    load().catch((requestError) => setError(toMessage(requestError, "Failed to load provider keys.")));
  }, []);

  async function createGlobalKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await adminService.createGlobalProviderKey({
        provider: String(formData.get("provider") ?? ""),
        label: String(formData.get("label") ?? ""),
        key: String(formData.get("key") ?? "")
      });
      form.reset();
      await load();
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to create global key."));
    }
  }

  async function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await adminService.saveProvider({
        provider: String(formData.get("provider") ?? ""),
        label: String(formData.get("label") ?? ""),
        baseUrl: String(formData.get("baseUrl") ?? ""),
        apiKey: String(formData.get("apiKey") ?? ""),
        enabled: formData.get("enabled") === "on"
      });
      form.reset();
      await load();
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to save provider."));
    }
  }

  return (
    <AdminPage title="Providers" description="Configure OpenAI-compatible providers, API keys, and global key metadata." error={error}>
      <Section title="Configure provider">
        <form
          className="grid gap-3 rounded-xl border border-hairline bg-surface p-5 lg:grid-cols-[160px_1fr_1fr_1fr_auto]"
          onSubmit={saveProvider}
        >
          <TextInput label="Provider id" name="provider" placeholder="openai" required />
          <TextInput label="Label" name="label" placeholder="OpenAI Production" required />
          <TextInput label="Base URL" name="baseUrl" placeholder="https://api.openai.com/v1" required />
          <TextInput label="API key" name="apiKey" type="password" autoComplete="off" required />
          <div className="flex items-end gap-3">
            <label className="flex h-10 items-center gap-2 text-sm text-muted">
              <input name="enabled" type="checkbox" defaultChecked className="h-4 w-4" />
              Enabled
            </label>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Section>

      <Section title="Configured providers">
        <div className="grid gap-3 lg:grid-cols-2">
          {providers.map((provider) => (
            <div key={provider.id} className="rounded-xl border border-hairline bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold tracking-tightish text-ink">{provider.label}</div>
                  <div className="font-mono text-[11px] text-dim">{provider.provider}</div>
                </div>
                <StatusBadge enabled={provider.enabled} />
              </div>
              <div className="mt-4 font-mono text-[11px] text-muted">{provider.baseUrl}</div>
              <div className="mt-1 text-[11px] text-dim">{provider.apiKeySet ? "API key stored" : "No API key"}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Legacy global key">
        <form
          className="grid gap-3 rounded-xl border border-hairline bg-surface p-5 lg:grid-cols-[180px_1fr_1fr_auto]"
          onSubmit={createGlobalKey}
        >
          <TextInput label="Provider" name="provider" placeholder="openai" required />
          <TextInput label="Label" name="label" placeholder="Global OpenAI" required />
          <TextInput label="Key" name="key" type="password" autoComplete="off" required />
          <div className="flex items-end">
            <Button type="submit">Add</Button>
          </div>
        </form>
      </Section>

      <Section title="All keys">
        <div className="grid gap-3 lg:grid-cols-2">
          {keys.map((key) => (
            <div key={key.id} className="rounded-xl border border-hairline bg-surface p-4">
              <div className="font-semibold tracking-tightish text-ink">{key.label}</div>
              <div className="mt-1 font-mono text-[11px] text-dim">
                {key.provider} · {key.scopeType}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </AdminPage>
  );
}

export function AdminModelAccessPage() {
  const [policies, setPolicies] = useState<ProviderModelPolicy[]>([]);
  const [providerAccessPolicies, setProviderAccessPolicies] = useState<ProviderAccessPolicy[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeProvider, setActiveProvider] = useState("openai");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProviderModelOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activePolicy = policies.find((policy) => policy.provider === activeProvider);

  async function load() {
    const [modelResponse, accessResponse, userResponse, groupResponse] = await Promise.all([
      adminService.modelAccess(),
      adminService.providerAccess(),
      adminService.users(),
      adminService.groups()
    ]);
    setPolicies(modelResponse.policies);
    setProviderAccessPolicies(accessResponse.providerAccessPolicies);
    setUsers(userResponse.users);
    setGroups(groupResponse.groups);
    if (!modelResponse.policies.some((policy) => policy.provider === activeProvider) && modelResponse.policies[0]) {
      setActiveProvider(modelResponse.policies[0].provider);
    }
  }

  useEffect(() => {
    load().catch((requestError) => setError(toMessage(requestError, "Failed to load model access policies.")));
  }, []);

  useEffect(() => {
    if (!activeProvider || activePolicy?.mode === "all") {
      setOptions([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      adminService.providerModels(activeProvider, query)
        .then((response) => setOptions(response.models))
        .catch(() => setOptions([]));
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [activeProvider, query, activePolicy?.mode]);

  async function updateMode(mode: ProviderModelPolicy["mode"]) {
    const response = await adminService.updateModelAccessMode(activeProvider, mode);
    setPolicies((current) => current.map((policy) => (policy.provider === activeProvider ? response.policy : policy)));
  }

  async function addModel(modelId: string) {
    if (!modelId || activePolicy?.models.includes(modelId)) return;
    const response = await adminService.addModelAccessRule(activeProvider, modelId);
    setPolicies((current) => current.map((policy) => (policy.provider === activeProvider ? response.policy : policy)));
    setQuery("");
  }

  async function removeModel(modelId: string) {
    await adminService.removeModelAccessRule(activeProvider, modelId);
    await load();
  }

  async function createProviderAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    await adminService.createProviderAccess({
      scopeType: String(formData.get("scopeType") ?? "group"),
      scopeId: String(formData.get("scopeType")) === "global" ? null : String(formData.get("scopeId") ?? ""),
      provider: String(formData.get("provider") ?? activeProvider),
      effect: String(formData.get("effect") ?? "allow")
    });
    form.reset();
    await load();
  }

  return (
    <AdminPage title="Model access" description="Control which models are available per provider with ALL, ALLOW, or DENY rules." error={error}>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-xl border border-hairline bg-surface p-3">
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-tighter2 text-dim">Providers</div>
          <div className="grid gap-0.5">
            {policies.map((policy) => {
              const isActive = activeProvider === policy.provider;
              return (
                <button
                  key={policy.provider}
                  type="button"
                  className={`relative rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    isActive ? "bg-elevated text-ink" : "text-muted hover:bg-elevated hover:text-ink"
                  }`}
                  onClick={() => setActiveProvider(policy.provider)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{policy.provider}</span>
                    <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-tighter2 text-muted">
                      {policy.mode}
                    </span>
                  </div>
                  {isActive ? (
                    <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-surface p-5">
          {activePolicy ? (
            <>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold tracking-tightish text-ink">{activePolicy.provider}</h2>
                  <p className="mt-1 text-sm text-muted">
                    ALL allows every model. ALLOW permits only listed models. DENY blocks listed models.
                  </p>
                </div>
                <select
                  className={selectClass}
                  value={activePolicy.mode}
                  onChange={(event) => void updateMode(event.target.value as ProviderModelPolicy["mode"])}
                >
                  <option value="all">ALL</option>
                  <option value="allow">ALLOW</option>
                  <option value="deny">DENY</option>
                </select>
              </div>

              {activePolicy.mode !== "all" ? (
                <div className="mb-4">
                  <TextInput
                    label="Search models"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search models returned by the provider"
                  />
                  {query ? (
                    <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-elevated">
                      {options.length === 0 ? <div className="p-3 text-sm text-dim">No models found.</div> : null}
                      {options.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
                          onClick={() => void addModel(option.id)}
                        >
                          <span className="font-medium">{option.id}</span>
                          {option.ownedBy ? (
                            <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-tighter2 text-muted">
                              {option.ownedBy}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-1.5">
                {activePolicy.models.length === 0 ? (
                  <span className="text-sm text-dim">No model rules configured.</span>
                ) : null}
                {activePolicy.models.map((modelId) => (
                  <span
                    key={modelId}
                    className="inline-flex items-center gap-2 rounded-full border border-line bg-elevated px-3 py-1 font-mono text-[11px] font-medium text-ink"
                  >
                    {modelId}
                    <button
                      type="button"
                      className="text-dim transition-colors hover:text-danger"
                      onClick={() => void removeModel(modelId)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <Section title="Provider access">
        <form
          className="mb-4 grid gap-3 rounded-xl border border-hairline bg-surface p-5 lg:grid-cols-[140px_1fr_160px_140px_auto]"
          onSubmit={createProviderAccess}
        >
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Scope</span>
            <select name="scopeType" className={selectClass}>
              <option value="group">Group</option>
              <option value="user">User</option>
              <option value="global">Global</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Target</span>
            <select name="scopeId" className={selectClass}>
              {groups.map((group) => (
                <option key={`group-${group.id}`} value={group.id}>
                  Group: {group.name}
                </option>
              ))}
              {users.map((user) => (
                <option key={`user-${user.id}`} value={user.id}>
                  User: {user.email}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Provider</span>
            <select name="provider" className={selectClass} defaultValue={activeProvider}>
              {policies.map((policy) => (
                <option key={policy.provider} value={policy.provider}>
                  {policy.provider}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Effect</span>
            <select name="effect" className={selectClass}>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit">Create</Button>
          </div>
        </form>
        <PolicyList
          rows={providerAccessPolicies.map((policy) => ({
            id: policy.id,
            title: `${policy.effect}: ${policy.provider}`,
            detail: `${policy.scopeType}: ${policy.scopeName}`
          }))}
        />
      </Section>
    </AdminPage>
  );
}

export function AdminDockerPage() {
  const [config, setConfig] = useState<DockerConfig | null>(null);
  const [check, setCheck] = useState<DockerConnectionCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    adminService.dockerConfig()
      .then((response) => setConfig(response.dockerConfig))
      .catch((requestError) => setError(toMessage(requestError, "Failed to load Docker configuration.")));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const response = await adminService.updateDockerConfig({
        connectionType: String(formData.get("connectionType") ?? "socket"),
        socketPath: String(formData.get("socketPath") ?? ""),
        tcpHost: String(formData.get("tcpHost") ?? ""),
        tcpPort: Number(formData.get("tcpPort") ?? 2375),
        tcpUseTls: formData.get("tcpUseTls") === "on",
        tcpUsername: emptyToNull(formData.get("tcpUsername")),
        tcpPassword: emptyToUndefined(formData.get("tcpPassword")),
        caCert: emptyToUndefined(formData.get("caCert")),
        clientCert: emptyToUndefined(formData.get("clientCert")),
        clientKey: emptyToUndefined(formData.get("clientKey"))
      });
      setConfig(response.dockerConfig);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to save Docker configuration."));
    }
  }

  async function checkConnection() {
    const response = await adminService.checkDockerConfig();
    setCheck(response.check);
  }

  return (
    <AdminPage title="Docker connection" description="Configure how Singulary reaches Docker for workspace runtimes." error={error}>
      {config ? (
        <form className="grid max-w-4xl gap-4 rounded-xl border border-hairline bg-surface p-6" onSubmit={save}>
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Connection type</span>
            <select name="connectionType" className={selectClass} defaultValue={config.connectionType}>
              <option value="socket">Unix socket</option>
              <option value="tcp">TCP endpoint</option>
            </select>
          </label>

          <TextInput label="Socket path" name="socketPath" defaultValue={config.socketPath} placeholder="/var/run/docker.sock" />

          <div className="grid gap-3 md:grid-cols-[1fr_140px]">
            <TextInput label="TCP host" name="tcpHost" defaultValue={config.tcpHost} placeholder="docker.local" />
            <TextInput label="TCP port" name="tcpPort" type="number" defaultValue={config.tcpPort} />
          </div>

          <Toggle name="tcpUseTls" label="Use TLS for TCP" description="Use https for the Docker TCP endpoint." defaultChecked={config.tcpUseTls} />
          <TextInput label="TCP username" name="tcpUsername" defaultValue={config.tcpUsername ?? ""} placeholder="Optional" />
          <TextInput label={config.tcpPasswordSet ? "TCP password (already set)" : "TCP password"} name="tcpPassword" type="password" autoComplete="off" placeholder="Leave empty to keep current value" />
          <Textarea label={config.caCertSet ? "CA certificate (already set)" : "CA certificate"} name="caCert" placeholder="Optional PEM value" />
          <Textarea label={config.clientCertSet ? "Client certificate (already set)" : "Client certificate"} name="clientCert" placeholder="Optional PEM value" />
          <Textarea label={config.clientKeySet ? "Client key (already set)" : "Client key"} name="clientKey" placeholder="Optional PEM value" />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Save Docker config</Button>
            <Button type="button" variant="secondary" onClick={() => void checkConnection()}>
              Check connection
            </Button>
            {saved ? <span className="text-sm text-accent">Saved</span> : null}
          </div>
          {check ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                check.ok ? "border-accent/30 bg-accentSoft text-accent" : "border-danger/30 bg-danger/5 text-danger"
              }`}
            >
              {check.message}
            </div>
          ) : null}
        </form>
      ) : null}
    </AdminPage>
  );
}

export function AdminQuotasPage() {
  const [budgets, setBudgets] = useState<TokenBudget[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState("group");

  async function load() {
    const [budgetResponse, userResponse, groupResponse, workspaceResponse, providerResponse] = await Promise.all([
      adminService.tokenBudgets(),
      adminService.users(),
      adminService.groups(),
      adminService.workspaces(),
      adminService.providers()
    ]);
    setBudgets(budgetResponse.tokenBudgets);
    setUsers(userResponse.users);
    setGroups(groupResponse.groups);
    setWorkspaces(workspaceResponse.workspaces);
    setProviders(providerResponse.providers);
  }

  useEffect(() => {
    load().catch((requestError) => setError(toMessage(requestError, "Failed to load quotas.")));
  }, []);

  async function createBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await adminService.createTokenBudget({
        scopeType,
        scopeId: scopeType === "global" ? null : String(formData.get("scopeId") ?? ""),
        provider: emptyToNull(formData.get("provider")),
        limitTokens: Number(formData.get("limitTokens") ?? 0),
        limitUsd: stringToNullableNumber(formData.get("limitUsd")),
        period: String(formData.get("period") ?? "monthly")
      });
      form.reset();
      await load();
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to create token quota."));
    }
  }

  return (
    <AdminPage title="Token quotas" description="Set global, group, workspace, or individual token limits." error={error}>
      <Section title="Create token quota">
        <form
          className="grid gap-3 rounded-xl border border-hairline bg-surface p-5 lg:grid-cols-[140px_1fr_160px_150px_150px_140px_auto]"
          onSubmit={createBudget}
        >
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Scope</span>
            <select className={selectClass} value={scopeType} onChange={(event) => setScopeType(event.target.value)}>
              <option value="group">Group</option>
              <option value="user">User</option>
              <option value="workspace">Workspace</option>
              <option value="global">Global</option>
            </select>
          </label>
          {scopeType === "global" ? (
            <div className="flex items-end text-sm text-muted">Applies to the whole instance.</div>
          ) : (
            <ScopeSelect scopeType={scopeType} users={users} groups={groups} workspaces={workspaces} />
          )}
          <TextInput label="Max tokens" name="limitTokens" type="number" min={1} placeholder="200000" required />
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Provider</span>
            <select name="provider" className={selectClass}>
              <option value="">All providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.provider}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <TextInput label="Max USD" name="limitUsd" type="number" min={0} step="0.01" placeholder="Optional" />
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Period</span>
            <select name="period" className={selectClass}>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="lifetime">lifetime</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Section>
      <Section title="Configured quotas">
        <PolicyList
          rows={budgets.map((budget) => ({
            id: budget.id,
            title: `${budget.scopeType}: ${budget.scopeName}`,
            detail: `${budget.limitTokens.toLocaleString()} tokens · ${budget.period}${
              budget.provider ? ` · ${budget.provider}` : " · all providers"
            }${budget.limitUsd ? ` · $${budget.limitUsd}` : ""}`
          }))}
        />
      </Section>
    </AdminPage>
  );
}

export function AdminPermissionsPage() {
  const [policies, setPolicies] = useState<PermissionPolicy[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [scopeType, setScopeType] = useState("group");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [policyResponse, userResponse, groupResponse, workspaceResponse] = await Promise.all([
      adminService.permissionPolicies(),
      adminService.users(),
      adminService.groups(),
      adminService.workspaces()
    ]);
    setPolicies(policyResponse.permissionPolicies);
    setUsers(userResponse.users);
    setGroups(groupResponse.groups);
    setWorkspaces(workspaceResponse.workspaces);
  }

  useEffect(() => {
    load().catch((requestError) => setError(toMessage(requestError, "Failed to load permissions.")));
  }, []);

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await adminService.createPermissionPolicy({
        scopeType,
        scopeId: scopeType === "global" ? null : String(formData.get("scopeId") ?? ""),
        permission: String(formData.get("permission") ?? ""),
        effect: String(formData.get("effect") ?? "allow")
      });
      form.reset();
      await load();
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to create permission policy."));
    }
  }

  return (
    <AdminPage title="Permissions" description="Manage platform policy entries for users, groups, workspaces, or globally." error={error}>
      <Section title="Create permission policy">
        <form
          className="grid gap-3 rounded-xl border border-hairline bg-surface p-5 lg:grid-cols-[160px_1fr_1fr_140px_auto]"
          onSubmit={createPolicy}
        >
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Scope</span>
            <select className={selectClass} value={scopeType} onChange={(event) => setScopeType(event.target.value)}>
              <option value="group">Group</option>
              <option value="user">User</option>
              <option value="workspace">Workspace</option>
              <option value="global">Global</option>
            </select>
          </label>
          {scopeType === "global" ? (
            <div className="flex items-end text-sm text-muted">Applies globally.</div>
          ) : (
            <ScopeSelect scopeType={scopeType} users={users} groups={groups} workspaces={workspaces} />
          )}
          <TextInput label="Permission" name="permission" placeholder="agent.shell.run" required />
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Effect</span>
            <select name="effect" className={selectClass}>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Section>
      <Section title="Policies">
        <PolicyList
          rows={policies.map((policy) => ({
            id: policy.id,
            title: `${policy.effect}: ${policy.permission}`,
            detail: `${policy.scopeType}: ${policy.scopeName}`
          }))}
        />
      </Section>
    </AdminPage>
  );
}

export function AdminRulesPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [config, setConfig] = useState<GroupConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedGroup = useMemo(() => groups.find((g) => g.id === selectedGroupId) ?? groups[0], [groups, selectedGroupId]);

  useEffect(() => {
    Promise.all([adminService.groups(), adminService.providers()])
      .then(([g, p]) => {
        setGroups(g.groups);
        setProviders(p.providers);
        if (g.groups[0]) setSelectedGroupId((current) => current || g.groups[0].id);
      })
      .catch((requestError) => setError(toMessage(requestError, "Failed to load groups.")));
  }, []);

  useEffect(() => {
    if (!selectedGroup) return;
    adminService
      .groupConfig(selectedGroup.id)
      .then((response) => setConfig(response.config))
      .catch((requestError) => setError(toMessage(requestError, "Failed to load group config.")));
  }, [selectedGroup?.id]);

  async function save() {
    if (!config || !selectedGroup) return;
    setError(null);
    setBusy(true);
    try {
      const response = await adminService.saveGroupConfig(selectedGroup.id, {
        limits: config.limits,
        tokenQuota: config.tokenQuota,
        providerAccess: config.providerAccess,
        modelAccess: config.modelAccess
      });
      setConfig(response.config);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to save group rules."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      title="Group rules"
      description="Each group is one place: limits, providers, models, and token quotas. Workspaces inherit access from the group they belong to."
      error={error}
    >
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-xl border border-hairline bg-surface p-3">
          <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-tighter2 text-dim">
            Groups
          </div>
          <div className="grid gap-0.5">
            {groups.map((group) => {
              const active = group.id === selectedGroup?.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`relative flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    active ? "bg-elevated text-ink" : "text-muted hover:bg-elevated hover:text-ink"
                  }`}
                >
                  <span className="min-w-0 truncate font-medium">
                    {group.isUserGroup ? "Personal space" : group.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-tighter2 text-dim">
                    {group.memberCount}
                  </span>
                  {active ? (
                    <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="grid gap-4">
          {!config ? (
            <div className="rounded-xl border border-hairline bg-surface p-8 text-sm text-muted">Select a group…</div>
          ) : (
            <>
              {config.isUserGroup ? (
                <div className="rounded-xl border border-accent/20 bg-accentSoft px-4 py-3 text-xs text-accent">
                  Personal spaces are immutable. Changes apply to non-personal groups only.
                </div>
              ) : null}

              <LimitsCard
                config={config}
                disabled={config.isUserGroup}
                onChange={(next) => setConfig({ ...config, limits: next })}
              />

              <TokenQuotaCard
                config={config}
                disabled={config.isUserGroup}
                onChange={(next) => setConfig({ ...config, tokenQuota: next })}
              />

              <AccessCard
                title="Provider access"
                subtitle="Restrict which LLM providers this group can use."
                mode={config.providerAccess.mode}
                items={config.providerAccess.providers}
                options={providers.map((p) => ({ value: p.provider, label: p.label }))}
                disabled={config.isUserGroup}
                onChange={(next) => setConfig({ ...config, providerAccess: next })}
              />

              <ModelAccessCard
                config={config}
                disabled={config.isUserGroup}
                onChange={(next) => setConfig({ ...config, modelAccess: next })}
              />

              <div className="sticky bottom-4 flex items-center justify-between rounded-xl border border-line bg-elevated/95 px-4 py-3 backdrop-blur">
                <div className="text-xs text-muted">
                  Changes apply immediately on save. Personal spaces are read-only.
                </div>
                <div className="flex items-center gap-3">
                  {saved ? <span className="text-xs text-accent">Saved</span> : null}
                  <Button onClick={save} disabled={busy || config.isUserGroup}>
                    {busy ? "Saving…" : "Save group rules"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminPage>
  );
}

function LimitsCard({
  config,
  disabled,
  onChange
}: {
  config: GroupConfig;
  disabled: boolean;
  onChange: (limits: GroupConfig["limits"]) => void;
}) {
  return (
    <RuleCard
      title="Limits"
      subtitle="Cap how many workspaces this group can have, and how many projects per workspace."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberToggle
          label="Max workspaces"
          value={config.limits.maxWorkspaces}
          placeholder="Unlimited"
          disabled={disabled}
          onChange={(value) => onChange({ ...config.limits, maxWorkspaces: value })}
        />
        <NumberToggle
          label="Max projects / workspace"
          value={config.limits.maxProjectsPerWorkspace}
          placeholder="Unlimited"
          disabled={disabled}
          onChange={(value) => onChange({ ...config.limits, maxProjectsPerWorkspace: value })}
        />
      </div>
    </RuleCard>
  );
}

function TokenQuotaCard({
  config,
  disabled,
  onChange
}: {
  config: GroupConfig;
  disabled: boolean;
  onChange: (next: GroupConfig["tokenQuota"]) => void;
}) {
  const q = config.tokenQuota;
  return (
    <RuleCard
      title="Token quota"
      subtitle="Cap how many tokens (and dollars) this group can spend per period."
      headerExtra={
        <SwitchToggle
          enabled={q.enabled}
          disabled={disabled}
          onToggle={(enabled) => onChange({ ...q, enabled })}
        />
      }
    >
      {q.enabled ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
            <span>Period</span>
            <select
              className={selectClass}
              value={q.period}
              disabled={disabled}
              onChange={(event) => onChange({ ...q, period: event.target.value as GroupConfig["tokenQuota"]["period"] })}
            >
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="lifetime">lifetime</option>
            </select>
          </label>
          <NumberToggle
            label="Token limit"
            value={q.limitTokens}
            placeholder="e.g. 200000"
            disabled={disabled}
            onChange={(value) => onChange({ ...q, limitTokens: value })}
          />
          <NumberToggle
            label="USD limit"
            value={q.limitUsd}
            placeholder="Optional"
            step={0.01}
            disabled={disabled}
            onChange={(value) => onChange({ ...q, limitUsd: value })}
          />
        </div>
      ) : (
        <div className="text-sm text-dim">No quota. Group can spend unrestricted on connected provider keys.</div>
      )}
    </RuleCard>
  );
}

function AccessCard({
  title,
  subtitle,
  mode,
  items,
  options,
  disabled,
  onChange
}: {
  title: string;
  subtitle: string;
  mode: "all" | "allow" | "deny";
  items: string[];
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onChange: (next: { mode: "all" | "allow" | "deny"; providers: string[] }) => void;
}) {
  function toggle(value: string) {
    const next = items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
    onChange({ mode, providers: next });
  }

  return (
    <RuleCard
      title={title}
      subtitle={subtitle}
      headerExtra={
        <SegmentedControl
          options={[
            { value: "all", label: "All" },
            { value: "allow", label: "Allow list" },
            { value: "deny", label: "Deny list" }
          ]}
          value={mode}
          disabled={disabled}
          onChange={(value) => onChange({ mode: value as "all" | "allow" | "deny", providers: items })}
        />
      }
    >
      {mode === "all" ? (
        <div className="text-sm text-dim">All providers configured on the instance are available.</div>
      ) : options.length === 0 ? (
        <div className="text-sm text-dim">No providers configured yet.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = items.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => toggle(option.value)}
                className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
                  active
                    ? "border-accent/40 bg-accentSoft text-accent"
                    : "border-line bg-elevated text-muted hover:border-line2 hover:text-ink"
                }`}
              >
                {active ? <Check size={12} /> : null}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </RuleCard>
  );
}

function ModelAccessCard({
  config,
  disabled,
  onChange
}: {
  config: GroupConfig;
  disabled: boolean;
  onChange: (next: GroupConfig["modelAccess"]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addModel() {
    const value = draft.trim();
    if (!value) return;
    if (config.modelAccess.models.includes(value)) {
      setDraft("");
      return;
    }
    onChange({ ...config.modelAccess, models: [...config.modelAccess.models, value] });
    setDraft("");
  }

  function removeModel(model: string) {
    onChange({ ...config.modelAccess, models: config.modelAccess.models.filter((item) => item !== model) });
  }

  return (
    <RuleCard
      title="Model access"
      subtitle="Allowlist or denylist specific model IDs (e.g. claude-opus-4-7, gpt-5)."
      headerExtra={
        <SegmentedControl
          options={[
            { value: "all", label: "All" },
            { value: "allow", label: "Allow list" },
            { value: "deny", label: "Deny list" }
          ]}
          value={config.modelAccess.mode}
          disabled={disabled}
          onChange={(value) => onChange({ ...config.modelAccess, mode: value as "all" | "allow" | "deny" })}
        />
      }
    >
      {config.modelAccess.mode === "all" ? (
        <div className="text-sm text-dim">Group can use any model permitted at the platform level.</div>
      ) : (
        <>
          <div className="flex gap-2">
            <TextInput
              placeholder="Add model id (claude-opus-4-7, gpt-5, …)"
              value={draft}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addModel();
                }
              }}
            />
            <Button variant="secondary" type="button" onClick={addModel} disabled={disabled}>
              Add
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {config.modelAccess.models.length === 0 ? (
              <span className="text-sm text-dim">No models in the list yet.</span>
            ) : null}
            {config.modelAccess.models.map((model) => (
              <span
                key={model}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-elevated px-3 py-1 font-mono text-[11px] text-ink"
              >
                {model}
                <button
                  type="button"
                  className="text-dim transition-colors hover:text-danger"
                  onClick={() => removeModel(model)}
                  disabled={disabled}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </>
      )}
    </RuleCard>
  );
}

function RuleCard({
  title,
  subtitle,
  headerExtra,
  children
}: {
  title: string;
  subtitle: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tightish text-ink">{title}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">{subtitle}</p>
        </div>
        {headerExtra}
      </header>
      {children}
    </section>
  );
}

function NumberToggle({
  label,
  value,
  placeholder,
  step,
  disabled,
  onChange
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  step?: number;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}) {
  const enabled = value != null;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-tightish text-muted">
        <span>{label}</span>
        <SwitchToggle
          enabled={enabled}
          disabled={disabled}
          onToggle={(next) => onChange(next ? (typeof value === "number" ? value : 0) : null)}
        />
      </div>
      {enabled ? (
        <input
          type="number"
          min={0}
          step={step ?? 1}
          value={value ?? 0}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") {
              onChange(0);
              return;
            }
            const parsed = Number(raw);
            onChange(Number.isFinite(parsed) ? parsed : null);
          }}
          className="focus-ring h-10 w-full rounded-lg border border-line bg-elevated px-3 text-sm text-ink hover:border-line2 focus:border-accent/60"
        />
      ) : (
        <div className="h-10 rounded-lg border border-dashed border-line px-3 text-sm leading-10 text-dim">
          {placeholder ?? "Unlimited"}
        </div>
      )}
    </div>
  );
}

function SwitchToggle({
  enabled,
  disabled,
  onToggle
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onToggle(!enabled)}
      className={`focus-ring relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
        enabled ? "bg-accent" : "bg-line"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function SegmentedControl({
  options,
  value,
  disabled,
  onChange
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-elevated p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`focus-ring h-7 rounded-md px-2.5 text-[11px] font-semibold uppercase tracking-tightish transition-colors disabled:opacity-50 ${
              active ? "bg-accent text-white" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    adminService.settings()
      .then((response) => setSettings(response.settings))
      .catch((requestError) => setError(toMessage(requestError, "Failed to load platform settings.")));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const response = await adminService.updateSettings({
        byokEnabled: formData.get("byokEnabled") === "on",
        globalProviderKeysEnabled: formData.get("globalProviderKeysEnabled") === "on",
        requireApprovalForDangerousTools: formData.get("requireApprovalForDangerousTools") === "on",
        defaultTokenQuota: stringToNullableNumber(formData.get("defaultTokenQuota")),
        maxWorkspacesPerUser: stringToNullableNumber(formData.get("maxWorkspacesPerUser")),
        maxProjectsPerWorkspace: stringToNullableNumber(formData.get("maxProjectsPerWorkspace"))
      });
      setSettings(response.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (requestError) {
      setError(toMessage(requestError, "Failed to save settings."));
    }
  }

  return (
    <AdminPage title="Platform settings" description="Configure global behavior for the instance." error={error}>
      {settings ? (
        <form className="grid max-w-3xl gap-4 rounded-xl border border-hairline bg-surface p-6" onSubmit={save}>
          <Toggle
            name="byokEnabled"
            label="Enable BYOK"
            description="Allow users to add personal, workspace, or organization provider keys."
            defaultChecked={settings.byokEnabled}
          />
          <Toggle
            name="globalProviderKeysEnabled"
            label="Enable global API keys"
            description="Allow admins to configure provider keys shared at platform scope."
            defaultChecked={settings.globalProviderKeysEnabled}
          />
          <Toggle
            name="requireApprovalForDangerousTools"
            label="Require approval for dangerous tools"
            description="Keep approval gates on for high-risk agent operations."
            defaultChecked={settings.requireApprovalForDangerousTools}
          />
          <TextInput
            label="Default token quota"
            name="defaultTokenQuota"
            type="number"
            min={1}
            placeholder="Optional"
            defaultValue={settings.defaultTokenQuota ?? ""}
          />
          <TextInput
            label="Max workspaces per user"
            name="maxWorkspacesPerUser"
            type="number"
            min={1}
            placeholder="Optional"
            defaultValue={settings.maxWorkspacesPerUser ?? ""}
          />
          <TextInput
            label="Max projects per workspace"
            name="maxProjectsPerWorkspace"
            type="number"
            min={1}
            placeholder="Optional"
            defaultValue={settings.maxProjectsPerWorkspace ?? ""}
          />
          <div className="flex items-center gap-3">
            <Button type="submit">Save settings</Button>
            {saved ? <span className="text-sm text-accent">Saved</span> : null}
          </div>
        </form>
      ) : null}
    </AdminPage>
  );
}

function AdminPage({
  title,
  description,
  error,
  children
}: {
  title: string;
  description: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-7">
        <div className="text-[10px] font-semibold uppercase tracking-tighter2 text-accent">Admin</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tighter2 text-ink">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>
      </div>
      {error ? (
        <div className="mb-5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}
      {children}
    </div>
  );
}

function ScopeSelect({
  scopeType,
  users,
  groups,
  workspaces
}: {
  scopeType: string;
  users: AdminUser[];
  groups: Group[];
  workspaces: Workspace[];
}) {
  const options =
    scopeType === "user"
      ? users.map((user) => ({ id: user.id, label: user.email }))
      : scopeType === "workspace"
        ? workspaces.map((workspace) => ({ id: workspace.id, label: workspace.name }))
        : groups.map((group) => ({ id: group.id, label: group.name }));

  return (
    <label className="grid gap-1.5 text-xs font-medium uppercase tracking-tightish text-muted">
      <span>Target</span>
      <select name="scopeId" className={selectClass} required>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PolicyList({ rows }: { rows: Array<{ id: string; title: string; detail: string }> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-muted">No records configured.</div>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((row) => (
            <li key={row.id} className="p-4">
              <div className="text-sm font-semibold text-ink">{row.title}</div>
              <div className="mt-1 text-xs text-muted">{row.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toggle({
  name,
  label,
  description,
  defaultChecked
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-hairline bg-elevated p-4">
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-1 block text-sm text-muted">{description}</span>
      </span>
      <input name={name} type="checkbox" className="mt-1 h-5 w-5" defaultChecked={defaultChecked} />
    </label>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tighter2 ${
        enabled
          ? "border-accent/30 bg-accentSoft text-accent"
          : "border-line bg-elevated text-dim"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-accent" : "bg-dim"}`} />
      {enabled ? "Enabled" : "Disabled"}
    </span>
  );
}

function RoleBadge({ role }: { role: AdminUser["role"] }) {
  const display = {
    instance_admin: "Instance Admin",
    user: "Developer",
    readonly: "Read-only"
  };
  const styles = {
    instance_admin: "border-accent/30 bg-accentSoft text-accent",
    user: "border-line bg-elevated text-ink",
    readonly: "border-line bg-elevated text-muted"
  };

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-tighter2 ${styles[role]}`}>
      {display[role]}
    </span>
  );
}

function stringToNullableNumber(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const raw = String(value ?? "").trim();
  return raw ? raw : undefined;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
