'use client'

import { useEffect, useState } from 'react'

export default function WebhookTokenPage() {
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [checking, setChecking] = useState(false)

  const fetchToken = async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/notion/webhook')
      const data = (await res.json()) as { verification_token: string | null }
      setToken(data.verification_token)
      if (data.verification_token) {
        console.log('[webhook-token] verification_token:', data.verification_token)
      }
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    void fetchToken()
    const interval = setInterval(() => { void fetchToken() }, 3000)
    return () => clearInterval(interval)
  }, [])

  const copy = async () => {
    if (!token) return
    await navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-xl mx-auto mt-16">
      <h1 className="text-xl font-bold text-cyan-400 mb-2">Notion Webhook Token</h1>
      <p className="text-xs text-zinc-500 mb-6">
        กด Resend/Retry verification บน Notion แล้วรอ token ปรากฏ (auto-refresh ทุก 3s)
      </p>

      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
        {token ? (
          <>
            <p className="text-xs text-zinc-500 mb-2">Verification Token</p>
            <p className="text-sm text-green-400 font-mono break-all mb-4">{token}</p>
            <button
              onClick={() => { void copy() }}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </>
        ) : (
          <p className="text-sm text-zinc-500">
            {checking ? 'Checking...' : 'รอ Notion ส่ง token มา...'}
          </p>
        )}
      </div>

      <button
        onClick={() => { void fetchToken() }}
        className="mt-4 text-xs text-zinc-500 hover:text-white transition-colors"
      >
        Refresh manually
      </button>
    </div>
  )
}
