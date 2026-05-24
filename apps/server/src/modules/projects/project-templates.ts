import type { ProjectTemplate } from "@singulary/shared";

export const projectTemplates: ProjectTemplate[] = [
  {
    id: "node-22",
    name: "Node 22",
    description: "Node.js 22 LTS with npm. Good default for React/Next.js/Express.",
    category: "javascript",
    runtimeKind: "node",
    image: "node:22-bookworm",
    installCommand: "npm install",
    startCommand: "npm run dev",
    iconKey: "node",
    hints: {
      workdir: "/workspace",
      depsVolumePath: "/workspace/node_modules",
      commonPorts: [3000, 3001, 4000, 5173, 8080]
    }
  },
  {
    id: "node-20",
    name: "Node 20",
    description: "Node.js 20 LTS with npm.",
    category: "javascript",
    runtimeKind: "node",
    image: "node:20-bookworm",
    installCommand: "npm install",
    startCommand: "npm run dev",
    iconKey: "node",
    hints: {
      workdir: "/workspace",
      depsVolumePath: "/workspace/node_modules",
      commonPorts: [3000, 5173, 8080]
    }
  },
  {
    id: "bun-1",
    name: "Bun 1",
    description: "Bun runtime. Fast install + run for TS/JS projects.",
    category: "javascript",
    runtimeKind: "bun",
    image: "oven/bun:1",
    installCommand: "bun install",
    startCommand: "bun run dev",
    iconKey: "bun",
    hints: {
      workdir: "/workspace",
      depsVolumePath: "/workspace/node_modules",
      commonPorts: [3000, 5173, 8080]
    }
  },
  {
    id: "deno-1",
    name: "Deno",
    description: "Deno runtime. Permissions on by default.",
    category: "javascript",
    runtimeKind: "deno",
    image: "denoland/deno:latest",
    installCommand: null,
    startCommand: "deno run --allow-net --allow-read --allow-env --watch main.ts",
    iconKey: "deno",
    hints: {
      workdir: "/workspace",
      depsVolumePath: null,
      commonPorts: [8000]
    }
  },
  {
    id: "python-3.12",
    name: "Python 3.12",
    description: "Python 3.12 slim with pip.",
    category: "python",
    runtimeKind: "python",
    image: "python:3.12-slim",
    installCommand: "pip install -r requirements.txt",
    startCommand: "python main.py",
    iconKey: "python",
    hints: {
      workdir: "/workspace",
      depsVolumePath: null,
      commonPorts: [8000, 5000, 8080]
    }
  },
  {
    id: "go-1.22",
    name: "Go 1.22",
    description: "Go toolchain with hot run via `go run`.",
    category: "compiled",
    runtimeKind: "go",
    image: "golang:1.22",
    installCommand: "go mod download",
    startCommand: "go run .",
    iconKey: "go",
    hints: {
      workdir: "/workspace",
      depsVolumePath: "/go/pkg",
      commonPorts: [8080, 3000, 4000]
    }
  },
  {
    id: "rust-1",
    name: "Rust",
    description: "Rust + Cargo. First run will compile dependencies.",
    category: "compiled",
    runtimeKind: "rust",
    image: "rust:1",
    installCommand: "cargo fetch",
    startCommand: "cargo run",
    iconKey: "rust",
    hints: {
      workdir: "/workspace",
      depsVolumePath: "/workspace/target",
      commonPorts: [8000, 3000]
    }
  },
  {
    id: "php-8.3",
    name: "PHP 8.3",
    description: "PHP CLI with built-in dev server.",
    category: "javascript",
    runtimeKind: "php",
    image: "php:8.3-cli",
    installCommand: "composer install",
    startCommand: "php -S 0.0.0.0:8000 -t public",
    iconKey: "php",
    hints: {
      workdir: "/workspace",
      depsVolumePath: "/workspace/vendor",
      commonPorts: [8000]
    }
  },
  {
    id: "static-nginx",
    name: "Static (nginx)",
    description: "Static site served by nginx. Drop files in the project root.",
    category: "static",
    runtimeKind: "static",
    image: "nginx:alpine",
    installCommand: null,
    startCommand: null,
    iconKey: "nginx",
    hints: {
      workdir: "/usr/share/nginx/html",
      depsVolumePath: null,
      commonPorts: [80]
    }
  },
  {
    id: "worker",
    name: "Background worker",
    description: "Node-based background worker. No HTTP port, just a loop.",
    category: "javascript",
    runtimeKind: "node",
    image: "node:22-bookworm",
    installCommand: "npm install",
    startCommand: "npm run dev",
    iconKey: "node",
    hints: {
      workdir: "/workspace",
      depsVolumePath: "/workspace/node_modules",
      commonPorts: []
    }
  },
  {
    id: "ubuntu-24",
    name: "Ubuntu (custom)",
    description: "Blank Ubuntu 24.04 — bring your own start command.",
    category: "custom",
    runtimeKind: "custom_dockerfile",
    image: "ubuntu:24.04",
    installCommand: null,
    startCommand: null,
    iconKey: "ubuntu",
    hints: {
      workdir: "/workspace",
      depsVolumePath: null,
      commonPorts: [3000, 8080]
    }
  }
];

export function getProjectTemplate(id: string | null): ProjectTemplate | null {
  if (!id) return null;
  return projectTemplates.find((template) => template.id === id) ?? null;
}

export function defaultTemplateFor(runtimeKind: string): ProjectTemplate {
  const match = projectTemplates.find((template) => template.runtimeKind === runtimeKind);
  return match ?? projectTemplates[0];
}
