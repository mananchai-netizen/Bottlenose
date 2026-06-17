import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface SandboxTestResult {
  passed: number
  failed: number
  output: string
  exitCode: number
}

const useRealSandbox = process.env.USE_REAL_SANDBOX === 'true'

export async function runTestsInSandbox(
  taskId: string,
  files: Record<string, string>,
  installCmd: string,
  testCmd: string,
): Promise<SandboxTestResult> {
  return useRealSandbox
    ? runWithVercelSandbox(files, installCmd, testCmd)
    : runWithExecSync(taskId, files, installCmd, testCmd)
}

// ─── Vercel Sandbox (production) ─────────────────────────────────────────────

async function runWithVercelSandbox(
  files: Record<string, string>,
  installCmd: string,
  testCmd: string,
): Promise<SandboxTestResult> {
  const { Sandbox } = await import('@vercel/sandbox')
  const sandbox = await Sandbox.create({ timeout: 90_000 })

  try {
    await sandbox.writeFiles(
      Object.entries(files).map(([filePath, content]) => ({ path: filePath, content })),
    )

    const [installBin, ...installArgs] = installCmd.trim().split(/\s+/)
    const installResult = await sandbox.runCommand(installBin!, installArgs, { timeoutMs: 90_000 })

    if (installResult.exitCode !== 0) {
      const [out, err] = await Promise.all([installResult.stdout(), installResult.stderr()])
      return {
        ...parseTestCounts(err),
        output: `$ ${installCmd}\n${out}${err}`.slice(0, 8_000),
        exitCode: installResult.exitCode,
      }
    }

    const [testBin, ...testArgs] = testCmd.trim().split(/\s+/)
    const testResult = await sandbox.runCommand(testBin!, testArgs, { timeoutMs: 90_000 })
    const [installOut, testOut, testErr] = await Promise.all([
      installResult.stdout(),
      testResult.stdout(),
      testResult.stderr(),
    ])

    const output = `$ ${installCmd}\n${installOut}\n$ ${testCmd}\n${testOut}${testErr}`
    return { ...parseTestCounts(output), output: output.slice(0, 8_000), exitCode: testResult.exitCode }
  } finally {
    await sandbox.stop()
  }
}

// ─── execSync fallback (local dev) ───────────────────────────────────────────

async function runWithExecSync(
  taskId: string,
  files: Record<string, string>,
  installCmd: string,
  testCmd: string,
): Promise<SandboxTestResult> {
  const dir = path.join(os.tmpdir(), 'han-test', taskId)

  try {
    fs.mkdirSync(dir, { recursive: true })

    for (const [filePath, content] of Object.entries(files)) {
      const target = path.resolve(dir, filePath)
      if (!target.startsWith(dir + path.sep) && target !== dir) continue
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content, 'utf8')
    }

    let output = ''
    let exitCode = 0

    try {
      const out = execSync(installCmd, { cwd: dir, timeout: 120_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      output += `$ ${installCmd}\n${out}\n`
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number }
      output += `$ ${installCmd}\nFAILED:\n${e.stdout ?? ''}${e.stderr ?? ''}\n`
      exitCode = e.status ?? 1
    }

    if (exitCode === 0) {
      try {
        const out = execSync(testCmd, { cwd: dir, timeout: 120_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
        output += `$ ${testCmd}\n${out}\n`
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; status?: number }
        output += `$ ${testCmd}\n${e.stdout ?? ''}${e.stderr ?? ''}\n`
        exitCode = e.status ?? 1
      }
    }

    return { ...parseTestCounts(output), output: output.slice(0, 8_000), exitCode }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTestCounts(output: string): { passed: number; failed: number } {
  const passMatch = /(\d+)\s+pass(?:ed)?/i.exec(output)
  const failMatch = /(\d+)\s+fail(?:ed)?/i.exec(output)
  return {
    passed: passMatch ? parseInt(passMatch[1]!, 10) : 0,
    failed: failMatch ? parseInt(failMatch[1]!, 10) : 0,
  }
}
