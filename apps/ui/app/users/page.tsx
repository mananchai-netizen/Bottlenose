'use client';

import { useEffect, useState } from 'react';

type Role = 'root' | 'admin';

interface UserRow {
  username: string;
  role: Role;
}

const EMPTY_FORM = { username: '', password: '', role: 'admin' as Role };

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('Failed to fetch');
      setUsers((await res.json()) as UserRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const openAdd = () => {
    setIsAdding(true);
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const openEdit = (u: UserRow) => {
    setIsAdding(false);
    setEditTarget(u.username);
    setForm({ username: u.username, password: '', role: u.role });
    setFormError(null);
  };

  const cancelForm = () => {
    setIsAdding(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const submit = async () => {
    setFormError(null);
    if (!form.username.trim()) { setFormError('Username is required'); return; }
    if (editTarget === null && !form.password.trim()) { setFormError('Password is required'); return; }
    setSaving(true);
    try {
      const url = editTarget !== null ? `/api/users/${encodeURIComponent(editTarget)}` : '/api/users';
      const method = editTarget !== null ? 'PUT' : 'POST';
      const body = editTarget !== null
        ? { ...(form.password ? { password: form.password } : {}), role: form.role }
        : { username: form.username, password: form.password, role: form.role };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      cancelForm();
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (username: string) => {
    if (!confirm(`Delete user "${username}"?`)) return;
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      alert(data.error ?? 'Delete failed');
      return;
    }
    void load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-cyan-600 dark:text-cyan-400">Users</h1>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Manage login accounts</p>
        </div>
        <button
          onClick={openAdd}
          className="text-sm px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors"
        >
          + Add User
        </button>
      </div>

      {/* Form */}
      {(isAdding || editTarget !== null) && (
        <div className="rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-4">
            {editTarget !== null ? `Edit — ${editTarget}` : 'Add User'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-zinc-400 mb-1 block">Username</label>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                disabled={editTarget !== null}
                placeholder="username"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-zinc-400 mb-1 block">
                Password {editTarget !== null && <span className="text-zinc-500">(leave blank to keep)</span>}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-zinc-400 mb-1 block">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-900 dark:text-zinc-100"
              >
                <option value="admin">admin</option>
                <option value="root">root</option>
              </select>
            </div>
          </div>
          {formError !== null && (
            <p className="text-xs text-red-500 mt-2">{formError}</p>
          )}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => { void submit(); }}
              disabled={saving}
              className="text-sm px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : editTarget !== null ? 'Save Changes' : 'Add User'}
            </button>
            <button
              onClick={cancelForm}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading && <p className="text-gray-400 dark:text-zinc-500 text-sm">Loading...</p>}
      {error !== null && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-600 dark:text-red-400 mb-4">
          {error}
        </div>
      )}
      {!loading && users.length === 0 && (
        <p className="text-gray-400 dark:text-zinc-500 text-sm">No users found.</p>
      )}
      {users.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {users.map((u) => (
                <tr key={u.username} className="bg-white dark:bg-zinc-950 hover:bg-gray-50 dark:hover:bg-zinc-900/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-zinc-100">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      u.role === 'root'
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                        : 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-xs px-3 py-1.5 rounded border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => { void remove(u.username); }}
                        className="text-xs px-3 py-1.5 rounded border border-red-200 dark:border-red-900 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
