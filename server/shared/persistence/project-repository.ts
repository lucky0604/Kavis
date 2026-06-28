import fs from 'fs';
import path from 'path';
import os from 'os';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { ProjectMeta } from '../../../shared/types';

const PROJECTS_FILE = path.join(os.homedir(), '.janus', 'projects.json');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

async function getGitStatus(projectPath: string): Promise<{ branch: string; isClean: boolean } | undefined> {
  try {
    const git: SimpleGit = simpleGit(projectPath);
    const [branch, status] = await Promise.all([
      git.branch(),
      git.status(),
    ]);
    return {
      branch: branch.current,
      isClean: status.isClean(),
    };
  } catch {
    // Not a git repo or git not available - silently ignore
    return undefined;
  }
}

export async function loadProjects(): Promise<ProjectMeta[]> {
  ensureDir(path.dirname(PROJECTS_FILE));
  if (!fs.existsSync(PROJECTS_FILE)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
  } catch {
    // File corrupted - return empty array
    return [];
  }
}

export async function saveProjects(projects: ProjectMeta[]): Promise<void> {
  ensureDir(path.dirname(PROJECTS_FILE));
  atomicWrite(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}
// ---------------------------------------------------------------------------
// WRITE LOCK — serializes all loadProjects → mutate → saveProjects operations
//
// Under Node.js single-threaded event loop, synchronous code between two awaits
// IS atomic.  But `await loadProjects()` yields control, so two concurrent
// requests can both READ the same array, mutate their own copies, and WRITE
// back — the second write clobbers the first (lost-update / read-then-write race).
//
// This Promise-chain mutex guarantees only one caller holds the lock at a time.
// If the server ever goes multi-process or horizontal, migrate to SQLite or a
// file-lock (flock) instead.
// ---------------------------------------------------------------------------
let _writeLock: Promise<void> = Promise.resolve();

function acquireWriteLock(): Promise<() => void> {
  let release: () => void;
  const prev = _writeLock;
  _writeLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(() => release!);
}

export async function addProject(rawPath: string): Promise<ProjectMeta> {
  const projectPath = path.resolve(rawPath);

  // Validate path exists and is a directory
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error(`Invalid directory path: ${projectPath}`);
  }

  // Get git status asynchronously (non-blocking, no lock needed)
  const gitInfo = await getGitStatus(projectPath);

  // ---------- locked section: load → mutate → save ----------
  const release = await acquireWriteLock();
  try {
    const projects = await loadProjects();

    // Check for duplicate path
    const existing = projects.find(p => p.path === projectPath);
    if (existing) {
      // Update lastAccessedAt and refresh git info if available
      existing.lastAccessedAt = new Date().toISOString();
      if (gitInfo) {
        existing.gitBranch = gitInfo.branch;
        existing.isGitClean = gitInfo.isClean;
      }
      await saveProjects(projects);
      return existing;
    }

    const newProject: ProjectMeta = {
      id: crypto.randomUUID(),
      name: path.basename(projectPath),
      path: projectPath,
      gitBranch: gitInfo?.branch,
      isGitClean: gitInfo?.isClean,
      lastAccessedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    projects.push(newProject);
    await saveProjects(projects);
    return newProject;
  } finally {
    release();
  }
}

export async function removeProject(projectId: string): Promise<void> {
  const release = await acquireWriteLock();
  try {
    const projects = await loadProjects();
    const filtered = projects.filter(p => p.id !== projectId);
    await saveProjects(filtered);
  } finally {
    release();
  }
}

export async function updateProjectLastAccessed(projectId: string): Promise<void> {
  const release = await acquireWriteLock();
  try {
    const projects = await loadProjects();
    const project = projects.find(p => p.id === projectId);
    if (project) {
      project.lastAccessedAt = new Date().toISOString();
      await saveProjects(projects);
    }
  } finally {
    release();
  }
}
