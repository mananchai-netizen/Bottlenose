'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectConfig } from '@/lib/types';
import { Field, Input } from '@/components/form-fields';

type FormState = {
  project_name: string;
  project_id: string;
  notion_db_id: string;
  github_repo: string;
  github_token: string;
  google_drive_folder_id: string;
  discord_channel_id: string;
};

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    project_name: '',
    project_id: '',
    notion_db_id: '',
    github_repo: '',
    github_token: '',
    google_drive_folder_id: '',
    discord_channel_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (k: keyof FormState) => (v: string) => {
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === 'project_name' ? { project_id: toSlug(v) } : {}),
    }));
  };

  const save = async () => {
    setError(null);
    if (!form.project_name || !form.project_id || !form.notion_db_id) {
      setError('Name, ID, and Notion DB are required.');
      return;
    }
    setSaving(true);
    const body: ProjectConfig = {
      project_id: form.project_id,
      project_name: form.project_name,
      notion_db_id: form.notion_db_id,
    };
    if (form.github_repo.length > 0) body.github_repo = form.github_repo;
    if (form.github_token.length > 0) body.github_token = form.github_token;
    if (form.google_drive_folder_id.length > 0) body.google_drive_folder_id = form.google_drive_folder_id;
    if (form.discord_channel_id.length > 0) body.discord_channel_id = form.discord_channel_id;

    const res = await fetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => router.push('/projects'), 800);
    } else {
      setError('Failed to save project.');
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-cyan-600 dark:text-cyan-400 mb-1">New Project</h1>
      <p className="text-xs text-gray-400 dark:text-zinc-500 mb-6">Connect a Notion database to the Han AI pool</p>

      <div className="space-y-5 max-w-lg">
        <Field label="Project Name *">
          <Input value={form.project_name} onChange={setField('project_name')} placeholder="My Project" />
        </Field>

        <Field label="Project ID *">
          <Input value={form.project_id} onChange={setField('project_id')} placeholder="my-project" />
          <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">Auto-generated from name. Used as machine filter in Notion.</p>
        </Field>

        <Field label="Notion Database ID *">
          <Input value={form.notion_db_id} onChange={setField('notion_db_id')} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">32-character ID from the Notion DB URL.</p>
        </Field>

        <div className="border-t border-gray-200 dark:border-zinc-800 pt-5">
          <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Optional integrations</p>
          <p className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Connect GitHub, Google Drive, or Discord for richer task output.</p>
          <div className="space-y-4">
            <Field label="GitHub Repo">
              <Input value={form.github_repo} onChange={setField('github_repo')} placeholder="org/repo" />
            </Field>
            <Field label="GitHub Token">
              <Input value={form.github_token} onChange={setField('github_token')} placeholder="github_pat_..." type="password" />
              <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">Fine-grained PAT — Contents + Pull requests (read &amp; write)</p>
            </Field>
            <Field label="Google Drive Folder ID">
              <Input value={form.google_drive_folder_id} onChange={setField('google_drive_folder_id')} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs" />
            </Field>
            <Field label="Discord Channel ID">
              <Input value={form.discord_channel_id} onChange={setField('discord_channel_id')} placeholder="123456789" />
            </Field>
          </div>
        </div>

        {error !== null && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}
        {saved && <p className="text-xs text-cyan-600 dark:text-cyan-400">Saved. Worker will apply project changes on next poll.</p>}

        <div className="flex gap-3">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {saving ? 'Saving...' : saved ? 'Saved' : 'Create Project'}
          </button>
          <button
            onClick={() => router.push('/projects')}
            className="px-5 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-400 dark:hover:border-zinc-500 text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

