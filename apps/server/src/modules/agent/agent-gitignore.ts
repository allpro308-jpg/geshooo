import fs from "node:fs/promises";
import path from "node:path";

export interface GitignoreMatcher {
  isIgnored(relPath: string): boolean;
}

const DEFAULT_IGNORES = [
  ".git",
  "node_modules",
  "target",
  "dist",
  ".next",
  ".cache",
  "build",
  "out",
  ".antigravitycli",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock"
];

function globToRegex(pattern: string): RegExp {
  // Simple glob to regex conversion
  let p = pattern.trim();
  
  // If it ends with /, match directories
  const isDirOnly = p.endsWith("/");
  if (isDirOnly) {
    p = p.slice(0, -1);
  }

  // Escape regex special chars except * and ?
  let regexStr = p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  if (p.startsWith("/")) {
    regexStr = "^" + regexStr.slice(1);
  } else {
    regexStr = "(^|/)" + regexStr;
  }

  if (isDirOnly) {
    regexStr = regexStr + "(/|$)";
  } else {
    regexStr = regexStr + "(/|$)";
  }

  return new RegExp(regexStr);
}

export async function loadGitignore(projectRoot: string): Promise<GitignoreMatcher> {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const patterns: RegExp[] = [];

  // Always load default ignores
  for (const def of DEFAULT_IGNORES) {
    patterns.push(globToRegex(def));
  }

  try {
    const content = await fs.readFile(gitignorePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      patterns.push(globToRegex(trimmed));
    }
  } catch (error) {
    // If .gitignore does not exist, that's fine. We already have defaults.
  }

  return {
    isIgnored(relPath: string): boolean {
      // Normalize path to use forward slashes
      const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!normalized) return false;
      return patterns.some((rx) => rx.test(normalized));
    }
  };
}
