'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ProjectConfig } from '@/lib/types';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch');
      setProjects((await res.json()) as ProjectConfig[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load on mount and after delete
  useEffect(() => { void load(); }, []);

  const remove = async (id: string) => {
    if (!confirm(`Delete project "${id}"?`)) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    void load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-cyan-600 dark:text-cyan-400">Projects</h1>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Manage Notion-connected projects</p>
        </div>
        <Link
          href="/projects/new"
          className="text-sm px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors"
        >
          + New Project
        </Link>
      </div>

      {loading && <p className="text-gray-400 dark:text-zinc-500 text-sm">Loading...</p>}
      {error !== null && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-600 dark:text-red-400 mb-4">
          {error}
        </div>
      )}

      {!loading && projects.length === 0 && error === null && (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30 px-4 py-10 text-center">
          <p className="text-sm text-gray-500 dark:text-zinc-500 mb-2">No projects yet.</p>
          <Link href="/projects/new" className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline">
            Create your first project →
          </Link>
        </div>
      )}

      <div className="grid gap-2.5">
        {projects.map((p) => (
          <div
            key={p.project_id}
            className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-5 py-4 flex items-center justify-between"
          >
            <div className="min-w-0">
              <div className="font-semibold text-sm text-gray-900 dark:text-zinc-100 mb-0.5">{p.project_name}</div>
              <div className="text-xs text-gray-400 dark:text-zinc-500">ID: <span className="font-mono">{p.project_id}</span></div>
              <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate">Notion: <span className="font-mono">{p.notion_db_id}</span></div>
              {p.github_repo !== undefined && (
                <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">GitHub: {p.github_repo}</div>
              )}
            </div>
            <div className="flex gap-2 shrink-0 ml-4">
              <Link
                href={`/projects/${p.project_id}/chat`}
                className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
              >
                Chat
              </Link>
              <Link
                href={`/projects/${p.project_id}`}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:border-gray-400 dark:hover:border-zinc-500 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Edit
              </Link>
              <button
                onClick={() => void remove(p.project_id)}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
