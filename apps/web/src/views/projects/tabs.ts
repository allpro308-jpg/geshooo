export type ProjectTab =
  | "code"
  | "environment"
  | "preview"
  | "branches"
  | "connections"
  | "settings";

export type ProjectTabDef = {
  id: ProjectTab;
  label: string;
  iconKey: "code" | "env" | "preview" | "branches" | "connections" | "settings";
  comingSoon?: boolean;
};

export const projectTabs: ProjectTabDef[] = [
  { id: "code", label: "Code", iconKey: "code" },
  { id: "preview", label: "Preview", iconKey: "preview" },
  { id: "environment", label: "Environment", iconKey: "env" },
  { id: "branches", label: "Branches", iconKey: "branches", comingSoon: true },
  { id: "connections", label: "Connections", iconKey: "connections", comingSoon: true },
  { id: "settings", label: "Settings", iconKey: "settings" }
];

const valid: ProjectTab[] = ["code", "environment", "preview", "branches", "connections", "settings"];

export function parseTab(value: string | null): ProjectTab {
  if (value && (valid as string[]).includes(value)) return value as ProjectTab;
  return "code";
}
