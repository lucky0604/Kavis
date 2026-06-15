import { useEffect, useState } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { useNativeBridge } from '../../../hooks/useNativeBridge';
import { useCodeModeSessionStore } from '../../../stores/code-mode-session-store';
import { ProjectItem } from './ProjectItem';
import styles from './ProjectSidebar.module.css';

function OpenFolderIcon() {
  return (
    <svg className={styles.openIcon} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.2 1.2A1 1 0 0 0 7.8 4.5H12.5A1.5 1.5 0 0 1 14 6v6.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5V4.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 7v4M6 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function ProjectSidebar() {
  const { projects, activeProjectId, addProject, setActiveProject, removeProject, fetchProjects } =
    useProjectStore();
  const { switchToProject } = useCodeModeSessionStore();
  const { selectFolder } = useNativeBridge();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const handleAddProject = async () => {
    setLoading(true);
    setError(null);

    try {
      const folderPath = await selectFolder();
      if (!folderPath) {
        const bridgeMissing = typeof window !== 'undefined'
          && !(window as Window & { janusNative?: { selectFolder?: unknown } }).janusNative?.selectFolder;
        if (bridgeMissing) {
          setError('Folder picker requires the Electron app. Run Janus as a desktop app to import projects.');
        }
        return;
      }

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to add project');
      }

      const data = await res.json();
      addProject(data.project);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[ProjectSidebar] Failed to add project:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveProject = async (projectId: string, projectName: string) => {
    if (!window.confirm(`Remove "${projectName}" from the list? Sessions are kept on disk.`)) {
      return;
    }
    setError(null);
    try {
      await removeProject(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove project');
    }
  };

  if (projects.length === 0 && !loading) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyText}>No workspaces yet</p>
        <p className={styles.emptyHint}>
          Open a local folder to start Code Mode sessions
        </p>
        <button
          className={styles.addButton}
          onClick={handleAddProject}
          disabled={loading}
        >
          {loading ? 'Opening…' : 'Open Workspace'}
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Workspaces</span>
      </div>

      <div className={styles.list}>
        {projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isActive={project.id === activeProjectId}
            onActivate={() => setActiveProject(project.id)}
            onFocus={() => {
              setActiveProject(project.id);
              void switchToProject(project.path);
            }}
            onRemove={() => void handleRemoveProject(project.id, project.name)}
          />
        ))}
      </div>

      <div className={styles.footer}>
        <button
          className={styles.openWorkspaceButton}
          onClick={handleAddProject}
          disabled={loading}
        >
          <OpenFolderIcon />
          {loading ? 'Opening…' : 'Open Workspace'}
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button onClick={() => setError(null)} className={styles.dismissError}>×</button>
        </div>
      )}
    </div>
  );
}
