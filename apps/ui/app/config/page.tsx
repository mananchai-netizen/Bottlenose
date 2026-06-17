'use client';

import { useEffect, useState } from 'react';
import type { MachineConfig, TaskType, BrainName, DevPublishMode } from '@/lib/types';
import { FieldGroup, GroupedField, GroupedInput } from '@/components/form-fields';

const TASK_TYPES: TaskType[] = ['dev', 'doc', 'sheet', 'slide'];
const BRAIN_NAMES: BrainName[] = [
  'claude-cli',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'llm-server',
];

type ConfigForm = Omit<MachineConfig, 'machine_id'> & {
  claude_api_key: string;
  gemini_api_key: string;
  notion_token: string;
  discord_token: string;
  line_channel_access_token: string;
  line_channel_secret: string;
  line_notify_token: string;
  google_key_path: string;
  google_oauth_client_path: string;
  google_oauth_token_path: string;
  dev_publish_mode: DevPublishMode;
  github_token: string;
  llm_server_url: string;
  llm_server_token: string;
  runpod_api_key: string;
  runpod_endpoint_id: string;
  runpod_sandbox_endpoint_id: string;
  runpod_callback_secret: string;
};

export default function ConfigPage() {
  const [form, setForm] = useState<ConfigForm | null>(null);
  const [masked, setMasked] = useState({
    notion_token: undefined as string | undefined,
    claude_api_key: undefined as string | undefined,
    gemini_api_key: undefined as string | undefined,
    discord_token: undefined as string | undefined,
    line_channel_access_token: undefined as string | undefined,
    line_channel_secret: undefined as string | undefined,
    line_notify_token: undefined as string | undefined,
    github_token: undefined as string | undefined,
    llm_server_token: undefined as string | undefined,
    runpod_api_key: undefined as string | undefined,
    runpod_callback_secret: undefined as string | undefined,
  });
  const [machineId, setMachineId] = useState<string>('');
  const [initialRedisUrl, setInitialRedisUrl] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = (await res.json()) as MachineConfig & Record<string, string | undefined>;
        setMachineId(data.machine_id);
        setInitialRedisUrl(data.redis_url);
        setMasked({
          notion_token:                data.notion_token_masked,
          claude_api_key:              data.claude_api_key_masked,
          gemini_api_key:              data.gemini_api_key_masked,
          discord_token:               data.discord_token_masked,
          line_channel_access_token:   data.line_channel_access_token_masked,
          line_channel_secret:         data.line_channel_secret_masked,
          line_notify_token:           data.line_notify_token_masked,
          github_token:                data.github_token_masked,
          llm_server_token:            data.llm_server_token_masked,
          runpod_api_key:              data.runpod_api_key_masked,
          runpod_callback_secret:      data.runpod_callback_secret_masked,
        });
        setForm({
          machine_name: data.machine_name,
          accept_types: data.accept_types,
          brain: data.brain,
          notion_token: '',
          claude_api_key: '',
          gemini_api_key: '',
          discord_token: '',
          redis_url: data.redis_url,
          poll_interval: data.poll_interval,
          max_concurrent_tasks: data.max_concurrent_tasks,
          line_channel_access_token: '',
          line_channel_secret: '',
          line_notify_token: '',
          google_key_path: data.google_key_path ?? '',
          google_oauth_client_path: data.google_oauth_client_path ?? '',
          google_oauth_token_path: data.google_oauth_token_path ?? '',
          dev_publish_mode: data.dev_publish_mode ?? 'cli',
          github_token: '',
          llm_server_url: data.llm_server_url ?? '',
          llm_server_token: '',
          runpod_api_key: '',
          runpod_endpoint_id: data.runpod_endpoint_id ?? '',
          runpod_sandbox_endpoint_id: data.runpod_sandbox_endpoint_id ?? '',
          runpod_callback_secret: '',
        });
      } else {
        setError('Run `han init` first to create a config.');
      }
    })();
  }, []);

  const save = async () => {
    if (form === null) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    if (form.notion_token.length === 0 && masked.notion_token === undefined) {
      setError('Notion token is required.');
      setSaving(false);
      return;
    }
    if (form.machine_name.trim().length === 0) {
      setError('Machine name is required.');
      setSaving(false);
      return;
    }
    if (form.accept_types.length === 0) {
      setError('At least one task type must be selected.');
      setSaving(false);
      return;
    }
    if (form.redis_url.trim().length === 0) {
      setError('Redis URL is required.');
      setSaving(false);
      return;
    }
    if (form.dev_publish_mode === 'github-api' && form.github_token.length === 0 && masked.github_token === undefined) {
      setError('GitHub token is required for GitHub API mode.');
      setSaving(false);
      return;
    }
    if (Object.values(form.brain).includes('llm-server') && form.llm_server_url.trim().length === 0) {
      setError('LLM Server URL is required when llm-server brain is selected.');
      setSaving(false);
      return;
    }
    const patch: Partial<MachineConfig> = {
      machine_name: form.machine_name,
      accept_types: form.accept_types,
      brain: form.brain,
      dev_publish_mode: form.dev_publish_mode,
      llm_server_url: form.llm_server_url.trim(),
      redis_url: form.redis_url,
      poll_interval: form.poll_interval,
      max_concurrent_tasks: form.max_concurrent_tasks,
    };
    if (form.notion_token.length > 0) patch.notion_token = form.notion_token;
    if (form.claude_api_key.length > 0) patch.claude_api_key = form.claude_api_key;
    if (form.gemini_api_key.length > 0) patch.gemini_api_key = form.gemini_api_key;
    if (form.discord_token.length > 0) patch.discord_token = form.discord_token;
    if (form.line_channel_access_token.length > 0) patch.line_channel_access_token = form.line_channel_access_token;
    if (form.line_channel_secret.length > 0) patch.line_channel_secret = form.line_channel_secret;
    if (form.line_notify_token.length > 0) patch.line_notify_token = form.line_notify_token;
    if (form.google_key_path.trim().length > 0) patch.google_key_path = form.google_key_path.trim();
    if (form.google_oauth_client_path.trim().length > 0) patch.google_oauth_client_path = form.google_oauth_client_path.trim();
    if (form.google_oauth_token_path.trim().length > 0) patch.google_oauth_token_path = form.google_oauth_token_path.trim();
    if (form.github_token.length > 0) patch.github_token = form.github_token;
    if (form.llm_server_token.length > 0) patch.llm_server_token = form.llm_server_token;
    if (form.runpod_api_key.length > 0) patch.runpod_api_key = form.runpod_api_key;
    if (form.runpod_endpoint_id.trim().length > 0) patch.runpod_endpoint_id = form.runpod_endpoint_id.trim();
    if (form.runpod_sandbox_endpoint_id.trim().length > 0) patch.runpod_sandbox_endpoint_id = form.runpod_sandbox_endpoint_id.trim();
    if (form.runpod_callback_secret.length > 0) patch.runpod_callback_secret = form.runpod_callback_secret;

    const res = await fetch('/api/config', { method: 'PUT', body: JSON.stringify(patch), headers: { 'Content-Type': 'application/json' } });
    if (res.ok) {
      setSaved(true);
      setSaveMessage(
        form.redis_url !== initialRedisUrl
          ? 'Saved. Restart worker to apply redis_url changes.'
          : 'Saved. Worker will apply changes on next poll.',
      );
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError('Save failed');
    }
    setSaving(false);
  };

  if (error !== null && form === null) {
    return <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>;
  }
  if (form === null) {
    return <p className="text-gray-400 dark:text-zinc-500 text-sm">Loading...</p>;
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-cyan-600 dark:text-cyan-400 mb-1">Machine Config</h1>
      <p className="text-xs text-gray-400 dark:text-zinc-500 mb-6">Configure this machine&apos;s AI brain and integrations</p>

      <div className="space-y-6 max-w-lg">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-2">Machine</p>
          <FieldGroup>
            <GroupedField label="Machine ID">
              <p className="font-mono text-sm text-gray-500 dark:text-zinc-400 select-all">{machineId}</p>
            </GroupedField>

            <GroupedField label="Machine Name *">
              <GroupedInput value={form.machine_name} onChange={(v) => setForm({ ...form, machine_name: v })} />
            </GroupedField>

            <GroupedField label="Accept Task Types *">
              <div className="flex gap-3 flex-wrap">
                {TASK_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer text-gray-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={form.accept_types.includes(t)}
                      onChange={(e) => {
                        const types = e.target.checked
                          ? [...form.accept_types, t]
                          : form.accept_types.filter((x) => x !== t);
                        setForm({ ...form, accept_types: types });
                      }}
                      className="accent-cyan-600 dark:accent-cyan-400"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </GroupedField>

            <GroupedField label="Redis URL *">
              <GroupedInput value={form.redis_url} onChange={(v) => setForm({ ...form, redis_url: v })} />
            </GroupedField>

            <GroupedField label="Default Brain">
              <select
                value={form.brain.default}
                onChange={(e) => setForm({ ...form, brain: { ...form.brain, default: e.target.value as BrainName } })}
                className="w-full bg-transparent text-sm text-gray-900 dark:text-zinc-100 focus:outline-none [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-zinc-900 dark:[&>option]:text-zinc-100"
              >
                {BRAIN_NAMES.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </GroupedField>
          </FieldGroup>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-2">LLM Server</p>
          <p className="text-xs text-gray-400 dark:text-zinc-600 mb-2">Token is optional. Leave blank to keep the existing token.</p>
          <FieldGroup>
            <GroupedField label="LLM Server URL">
              <GroupedInput
                value={form.llm_server_url}
                onChange={(v) => setForm({ ...form, llm_server_url: v })}
                placeholder="https://xxxx.ngrok-free.app"
              />
            </GroupedField>
            <GroupedField label="LLM Server Token">
              <GroupedInput
                value={form.llm_server_token}
                onChange={(v) => setForm({ ...form, llm_server_token: v })}
                placeholder={masked.llm_server_token ?? 'optional bearer token'}
              />
            </GroupedField>
          </FieldGroup>
        </div>


        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-2">Dev Publish</p>
          <p className="text-xs text-gray-400 dark:text-zinc-600 mb-2">GitHub token is only required for GitHub API mode. Leave blank to keep the existing token.</p>
          <FieldGroup>
            <GroupedField label="Dev Publish Mode *">
              <select
                value={form.dev_publish_mode}
                onChange={(e) => setForm({ ...form, dev_publish_mode: e.target.value as DevPublishMode })}
                className="w-full bg-transparent text-sm text-gray-900 dark:text-zinc-100 focus:outline-none [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-zinc-900 dark:[&>option]:text-zinc-100"
              >
                <option value="cli">CLI (git + gh)</option>
                <option value="github-api">GitHub API</option>
              </select>
            </GroupedField>
            <GroupedField label="GitHub Token">
              <GroupedInput
                value={form.github_token}
                onChange={(v) => setForm({ ...form, github_token: v })}
                placeholder={masked.github_token ?? 'github_pat_xxx...xxx'}
              />
            </GroupedField>
          </FieldGroup>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-2">Notion</p>
          <p className="text-xs text-gray-400 dark:text-zinc-600 mb-2">Leave blank to keep the existing value.</p>
          <FieldGroup>
            <GroupedField label="Notion Token *">
              <GroupedInput
                value={form.notion_token}
                onChange={(v) => setForm({ ...form, notion_token: v })}
                placeholder={masked.notion_token ?? 'ntn_xxx...xxx'}
              />
            </GroupedField>
          </FieldGroup>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-2">Google Drive</p>
          <FieldGroup>
            <GroupedField label="Google OAuth Client Path">
              <GroupedInput
                value={form.google_oauth_client_path}
                onChange={(v) => setForm({ ...form, google_oauth_client_path: v })}
                placeholder="~/.han/google-oauth-client.json"
              />
            </GroupedField>
            <GroupedField label="Google OAuth Token Path">
              <GroupedInput
                value={form.google_oauth_token_path}
                onChange={(v) => setForm({ ...form, google_oauth_token_path: v })}
                placeholder="~/.han/google-oauth-token.json"
              />
            </GroupedField>
          </FieldGroup>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-2">Claude / Gemini</p>
          <p className="text-xs text-gray-400 dark:text-zinc-600 mb-2">Leave blank to keep the existing value.</p>
          <FieldGroup>
            <GroupedField label="Claude API Key">
              <GroupedInput
                value={form.claude_api_key}
                onChange={(v) => setForm({ ...form, claude_api_key: v })}
                placeholder={masked.claude_api_key ?? 'sk-ant-api-xxx...xxx'}
              />
            </GroupedField>
            <GroupedField label="Gemini API Key">
              <GroupedInput
                value={form.gemini_api_key}
                onChange={(v) => setForm({ ...form, gemini_api_key: v })}
                placeholder={masked.gemini_api_key ?? 'xxx...xxx'}
              />
            </GroupedField>
          </FieldGroup>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-2">RunPod</p>
          <p className="text-xs text-gray-400 dark:text-zinc-600 mb-2">
            API key and secrets — leave blank to keep existing values.
            Endpoint IDs are not secret and can be edited freely.
          </p>
          <FieldGroup>
            <GroupedField label="RunPod API Key">
              <GroupedInput
                value={form.runpod_api_key}
                onChange={(v) => setForm({ ...form, runpod_api_key: v })}
                placeholder={masked.runpod_api_key ?? 'rpa_xxx...xxx'}
              />
            </GroupedField>
            <GroupedField label="Endpoint ID (LLM worker)">
              <GroupedInput
                value={form.runpod_endpoint_id}
                onChange={(v) => setForm({ ...form, runpod_endpoint_id: v })}
                placeholder="xxxxxxxxxxxxxxxx"
              />
            </GroupedField>
            <GroupedField label="Endpoint ID (Sandbox / dev tasks)">
              <GroupedInput
                value={form.runpod_sandbox_endpoint_id}
                onChange={(v) => setForm({ ...form, runpod_sandbox_endpoint_id: v })}
                placeholder="xxxxxxxxxxxxxxxx (optional)"
              />
            </GroupedField>
            <GroupedField label="Callback Secret">
              <GroupedInput
                value={form.runpod_callback_secret}
                onChange={(v) => setForm({ ...form, runpod_callback_secret: v })}
                placeholder={masked.runpod_callback_secret ?? 'random secret string'}
              />
            </GroupedField>
          </FieldGroup>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-2">LINE</p>
          <p className="text-xs text-gray-400 dark:text-zinc-600 mb-2">Leave blank to keep the existing value.</p>
          <FieldGroup>
            <GroupedField label="Channel Access Token *">
              <GroupedInput
                value={form.line_channel_access_token}
                onChange={(v) => setForm({ ...form, line_channel_access_token: v })}
                placeholder={masked.line_channel_access_token ?? 'xxx...xxx'}
              />
            </GroupedField>
            <GroupedField label="Channel Secret *">
              <GroupedInput
                value={form.line_channel_secret}
                onChange={(v) => setForm({ ...form, line_channel_secret: v })}
                placeholder={masked.line_channel_secret ?? 'xxx...xxx'}
              />
            </GroupedField>
            <GroupedField label="Notify Token">
              <GroupedInput
                value={form.line_notify_token}
                onChange={(v) => setForm({ ...form, line_notify_token: v })}
                placeholder={masked.line_notify_token ?? 'xxx...xxx (optional)'}
              />
            </GroupedField>
          </FieldGroup>
        </div>


        {error !== null && <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>}
        {saveMessage !== null && <p className="text-xs text-cyan-600 dark:text-cyan-400">{saveMessage}</p>}

        <button
          onClick={() => void save()}
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Config'}
        </button>
      </div>
    </div>
  );
}

