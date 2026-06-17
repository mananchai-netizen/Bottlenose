'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { MachineInfo } from '@/lib/types';

const REFRESH_INTERVALS = [1, 2, 3, 5, 10];
const REDIS_CLEAR_MODES = [
  {
    value: 'registry',
    label: 'Machine list only',
    confirm: 'Clear the Machine Status list from Redis?',
    danger: false,
  },
  {
    value: 'locks',
    label: 'Notion task locks only',
    confirm: 'Clear Redis locks for Notion tasks? This does not delete Notion tasks. Do this only when workers are stopped or stuck.',
    danger: true,
  },
  {
    value: 'all',
    label: 'Machine list + Notion task locks',
    confirm: 'Clear both the Machine Status list and Redis locks for Notion tasks? This does not delete Notion tasks. Do this only for a full reset.',
    danger: true,
  },
] as const;

type RedisClearMode = (typeof REDIS_CLEAR_MODES)[number]['value'];

function activityClass(status: string | undefined): string {
  switch (status) {
    case 'working':
      return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400';
    case 'planning':
      return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400';
    case 'polling':
      return 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400';
    case 'retrying':
      return 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400';
    case 'error':
      return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400';
    case 'reloading':
      return 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400';
    default:
      return 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-500';
  }
}

function activityLabel(status: string | undefined): string {
  if (status === undefined) return 'Idle';
  return status.replace(/_/g, ' ');
}

export default function StatusPage() {
  const [machines, setMachines] = useState<MachineInfo[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [refreshSeconds, setRefreshSeconds] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redisClearMode, setRedisClearMode] = useState<RedisClearMode>('registry');
  const [clearingRedis, setClearingRedis] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const selectedClearMode = REDIS_CLEAR_MODES.find((mode) => mode.value === redisClearMode) ?? REDIS_CLEAR_MODES[0];

  const loadMachines = useCallback(async () => {
    try {
      const res = await fetch('/api/machines');
      if (!res.ok) throw new Error('Failed to fetch');
      setMachines((await res.json()) as MachineInfo[]);
      setNow(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadMachines(), 0);
    const interval = setInterval(() => void loadMachines(), refreshSeconds * 1000);
    return () => {
      window.clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, [loadMachines, refreshSeconds]);

  const clearRedis = useCallback(async () => {
    if (!window.confirm(selectedClearMode.confirm)) return;

    setClearingRedis(true);
    setClearMessage(null);
    try {
      const res = await fetch('/api/machines/redis-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: redisClearMode }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to clear Redis');
      setClearMessage(`Cleared ${selectedClearMode.label.toLowerCase()}.`);
      await loadMachines();
    } catch (e) {
      setClearMessage(e instanceof Error ? e.message : 'Failed to clear Redis');
    } finally {
      setClearingRedis(false);
    }
  }, [loadMachines, redisClearMode, selectedClearMode]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-cyan-600 dark:text-cyan-400">Machine Status</h1>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">Connected machines in the Han AI pool</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500 bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 px-2.5 py-1 rounded-full">
            Auto-refresh
            <select
              value={refreshSeconds}
              onChange={(e) => setRefreshSeconds(Number(e.target.value))}
              className="bg-transparent text-gray-700 dark:text-zinc-200 focus:outline-none [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-zinc-900 dark:[&>option]:text-zinc-100"
            >
              {REFRESH_INTERVALS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds}s
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500 bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 px-2.5 py-1 rounded-full">
            Clear
            <select
              value={redisClearMode}
              onChange={(e) => setRedisClearMode(e.target.value as RedisClearMode)}
              className="bg-transparent text-gray-700 dark:text-zinc-200 focus:outline-none [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-zinc-900 dark:[&>option]:text-zinc-100"
              disabled={clearingRedis}
            >
              {REDIS_CLEAR_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void clearRedis()}
            disabled={clearingRedis}
            className="text-xs px-3 py-1.5 rounded-full border border-red-200 dark:border-red-900/70 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:border-red-400 dark:hover:border-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {clearingRedis ? 'Clearing...' : 'Clear From Redis'}
          </button>
        </div>
      </div>

      {loading && <p className="text-gray-400 dark:text-zinc-500 text-sm">Loading...</p>}
      {error !== null && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error} — is Redis running?
        </div>
      )}

      {clearMessage !== null && (
        <div className="mb-4 rounded-lg border border-cyan-200 dark:border-cyan-900/70 bg-cyan-50 dark:bg-cyan-950/30 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
          {clearMessage}
        </div>
      )}


      <div className="grid gap-2.5">
        {machines.map((m) => (
          <div
            key={m.machine_id}
            className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-5 py-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`shrink-0 inline-block h-2.5 w-2.5 rounded-full ${
                  m.status === 'online' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-gray-300 dark:bg-zinc-600'
                }`}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-gray-900 dark:text-zinc-100">{m.machine_name}</span>
                  <span className="text-xs text-gray-400 dark:text-zinc-500 font-mono truncate">{m.machine_id}</span>
                </div>
                <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                  Accepts: <span className="text-gray-600 dark:text-zinc-400">{m.accept_types.join(', ')}</span>
                </div>
                {m.activity_message !== undefined && (
                  <div className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                    {m.activity_message}
                  </div>
                )}
                {m.current_task !== undefined && (
                  <div className="text-xs text-amber-600 dark:text-yellow-400 mt-0.5">
                    Task ID: <span className="font-mono">{m.current_task}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="text-right shrink-0 ml-4">
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  m.status === 'online'
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-500'
                }`}
              >
                {m.status}
              </span>
              <div className="text-xs text-gray-400 dark:text-zinc-600 mt-1">
                {Math.round((now - m.last_seen) / 1000)}s ago
              </div>
              <div className={`text-xs px-2.5 py-1 rounded-full font-medium mt-2 capitalize ${activityClass(m.activity_status)}`}>
                {activityLabel(m.activity_status)}
              </div>
              {m.activity_updated_at !== undefined && (
                <div className="text-xs text-gray-400 dark:text-zinc-600 mt-1">
                  activity {Math.round((now - m.activity_updated_at) / 1000)}s ago
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <Link
          href="/projects"
          className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:border-gray-400 dark:hover:border-zinc-500 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          Manage Projects →
        </Link>
        <Link
          href="/config"
          className="text-sm px-4 py-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:border-gray-400 dark:hover:border-zinc-500 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          Machine Config →
        </Link>
      </div>
    </div>
  );
}
