export type ProjectTab =
  | "code"
  | "environment"
  | "preview"
  | "snapshots"
  | "connections"
  | "settings";

export type ProjectTabDef = {
  id: ProjectTab;
  label: string;
  iconKey: "code" | "env" | "preview" | "snapshots" | "connections" | "settings";
  comingSoon?: boolean;
};

export const projectTabs: ProjectTabDef[] = [
  { id: "code", label: "الكود", iconKey: "code" },
  { id: "preview", label: "المعاينة", iconKey: "preview" },
  { id: "environment", label: "البيئة", iconKey: "env" },
  { id: "snapshots", label: "اللقطات", iconKey: "snapshots" },
  { id: "connections", label: "الاتصالات", iconKey: "connections", comingSoon: true },
  { id: "settings", label: "الإعدادات", iconKey: "settings" }
];

const valid: ProjectTab[] = [
  "code",
  "environment",
  "preview",
  "snapshots",
  "connections",
  "settings"
];

export function parseTab(value: string | null): ProjectTab {
  if (value && (valid as string[]).includes(value)) return value as ProjectTab;
  return "code";
}
