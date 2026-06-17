import { createRequire } from 'module'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname } from 'path'

const require = createRequire(import.meta.url)

function patchDir(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      patchDir(fullPath)
      continue
    }
    if (!entry.endsWith('.js') && !entry.endsWith('.cjs')) continue
    const mapPath = fullPath + '.map'
    if (existsSync(mapPath)) continue

    let content = readFileSync(fullPath, 'utf8')
    const patched = content.replace(/\n\/\/# sourceMappingURL=\S+\.map.*/g, '')
    if (patched.length < content.length) {
      writeFileSync(fullPath, patched)
      console.log(`patched ${fullPath.replace(/.*node_modules\//, '')}`)
    }
  }
}

try {
  const pkgDir = dirname(require.resolve('@vercel/sandbox/package.json'))
  patchDir(join(pkgDir, 'dist'))
  console.log('patch-vercel-sandbox done')
} catch (e) {
  console.log('skip patch-vercel-sandbox:', e.message)
}
