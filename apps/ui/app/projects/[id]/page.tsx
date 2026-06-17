'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectConfig } from '@/lib/types';
import { Field, Input } from '@/components/form-fields';

type FormState = {
  project_name: string;
  notion_db_id: string;
  github_repo: string;
  github_token: string;
  google_drive_folder_id: string;
  discord_channel_id: string;
};

export default function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);

  useEffect(() => {
    if (id === null) return;
    void (async () => {
      const res = await fetch(`/api/projects/${id}`);
      if (res.ok) {
        const p = (await res.json()) as ProjectConfig;
        setForm({
          project_name: p.project_name,
          notion_db_id: p.notion_db_id,
          github_repo: p.github_repo ?? '',
          github_token: p.github_token ?? '',
          google_drive_folder_id: p.google_drive_folder_id ?? '',
          discord_channel_id: p.discord_channel_id ?? '',
        });
      } else {
        setError('Project not found.');
      }
    })();
  }, [id]);

  const save = async () => {
    if (form === null) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    const patch: Partial<ProjectConfig> = {
      project_name: form.project_name,
      notion_db_id: form.notion_db_id,
    };
    if (form.github_repo.length > 0) patch.github_repo = form.github_repo;
    if (form.github_token.length > 0) patch.github_token = form.github_token;
    if (form.google_drive_folder_id.length > 0) patch.google_drive_folder_id = form.google_drive_folder_id;
    if (form.discord_channel_id.length > 0) patch.discord_channel_id = form.discord_channel_id;

    const res = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      setSaved(true);
      setSaveMessage('Saved. Worker will apply project changes on next poll.');
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError('Save failed.');
    }
    setSaving(false);
  };

  if (error !== null) return <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>;
  if (form === null) return <p className="text-gray-400 dark:text-zinc-500 text-sm">Loading...</p>;

  return (
    <div>
      <h1 className="text-xl font-bold text-cyan-600 dark:text-cyan-400 mb-1">Edit Project</h1>
      <p className="text-xs text-gray-400 dark:text-zinc-500 mb-6">ID: <span className="font-mono">{id}</span></p>

      <div className="space-y-5 max-w-lg">
        <Field label="Project Name">
          <Input value={form.project_name} onChange={(v) => setForm({ ...form, project_name: v })} />
        </Field>

        <Field label="Notion Database ID">
          <Input value={form.notion_db_id} onChange={(v) => setForm({ ...form, notion_db_id: v })} />
        </Field>

        <div className="border-t border-gray-200 dark:border-zinc-800 pt-5">
          <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 mb-4">Optional integrations</p>
          <div className="space-y-4">
            <Field label="GitHub Repo">
              <Input value={form.github_repo} onChange={(v) => setForm({ ...form, github_repo: v })} placeholder="org/repo" />
            </Field>
            <Field label="GitHub Token">
              <Input value={form.github_token} onChange={(v) => setForm({ ...form, github_token: v })} placeholder="github_pat_..." type="password" />
              <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">Fine-grained PAT — Contents + Pull requests (read &amp; write)</p>
            </Field>
            <Field label="Google Drive Folder ID">
              <Input value={form.google_drive_folder_id} onChange={(v) => setForm({ ...form, google_drive_folder_id: v })} />
            </Field>
            <Field label="Discord Channel ID">
              <Input value={form.discord_channel_id} onChange={(v) => setForm({ ...form, discord_channel_id: v })} />
            </Field>
          </div>
        </div>

        {error !== null && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}
        {saveMessage !== null && <p className="text-xs text-cyan-600 dark:text-cyan-400">{saveMessage}</p>}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
          <button
            onClick={() => router.push('/projects')}
            className="px-5 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-400 dark:hover:border-zinc-500 text-sm transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

