export function detectTestCommand(fileTree: string[]): string {
  if (fileTree.some((f) => /vitest\.config\.[cm]?[jt]s$/.test(f))) return 'npx vitest run --reporter=verbose'
  if (fileTree.some((f) => /jest\.config\.[cm]?[jt]s$/.test(f))) return 'npx jest --ci --passWithNoTests'
  if (fileTree.some((f) => f === 'pytest.ini' || f === 'pyproject.toml')) return 'python -m pytest -v'
  return 'npm test -- --passWithNoTests'
}

export function detectInstallCommand(fileTree: string[]): string {
  if (fileTree.some((f) => f === 'pnpm-lock.yaml')) return 'pnpm install --frozen-lockfile'
  if (fileTree.some((f) => f === 'yarn.lock')) return 'yarn install --frozen-lockfile'
  if (fileTree.some((f) => f === 'requirements.txt')) return 'pip install -r requirements.txt -q'
  return 'npm install --frozen-lockfile'
}

export function detectTestFramework(fileTree: string[]): string {
  if (fileTree.some((f) => /vitest\.config/.test(f))) return 'vitest'
  if (fileTree.some((f) => /jest\.config/.test(f))) return 'jest'
  if (fileTree.some((f) => f === 'pytest.ini' || f === 'pyproject.toml')) return 'pytest'
  return 'jest'
}
