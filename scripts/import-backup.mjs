/**
 * Bring a phone backup's shelf edits into data/overrides.json.
 *
 *   node scripts/import-backup.mjs record-crate-backup-….json          # show what would change
 *   node scripts/import-backup.mjs record-crate-backup-….json --write  # do it (keeps a copy first)
 *
 * Then `npm run snapshot` so the app ships with them.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../server/config.js'
import { fromBackup, mergeIntoOverrides } from '../shared/backup.js'

const [file, flag] = process.argv.slice(2)
if (!file) {
  console.error('usage: node scripts/import-backup.mjs <backup.json> [--write]')
  process.exit(2)
}
const backup = fromBackup(fs.readFileSync(file, 'utf8'))
const target = path.join(DATA_DIR, 'overrides.json')
const overrides = JSON.parse(fs.readFileSync(target, 'utf8'))
const { overrides: next, changes } = mergeIntoOverrides(overrides, backup.local)

console.log(`Backup saved ${backup.savedAt}, made against the snapshot of ${backup.snapshot}`)
console.log(changes.length ? changes.join('\n') : 'Nothing to change.')
if (flag !== '--write' || !changes.length) process.exit(0)

const copy = `${target}.before-import-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.copyFileSync(target, copy)
fs.writeFileSync(`${target}.tmp`, JSON.stringify(next, null, 2))
fs.renameSync(`${target}.tmp`, target)
console.log(`Written. The previous overrides are in ${path.basename(copy)}.`)
