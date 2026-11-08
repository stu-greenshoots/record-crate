import { loadConfig } from '../config'
import { createDb, migrateDown, migrateToLatest } from './index'
import { seedFromSnapshot } from './seed'

const [command, ...args] = process.argv.slice(2)
const config = loadConfig()
const db = createDb(config.databaseUrl, 2)

try {
  if (command === 'migrate') {
    const ran = await migrateToLatest(db)
    console.log(ran.length ? `Ran ${ran.join(', ')}` : 'Already up to date')
  } else if (command === 'down') {
    const ran = await migrateDown(db)
    console.log(ran.length ? `Undid ${ran.join(', ')}` : 'Nothing to undo')
  } else if (command === 'seed') {
    await migrateToLatest(db)
    const counts = await seedFromSnapshot(db, args[0] || 'public')
    console.log(`Seeded ${counts.username}: ${counts.owned} records, ${counts.details} pressings, ${counts.artists} artists`)
  } else {
    console.error('Usage: db migrate | db down | db seed [public-dir]')
    process.exitCode = 1
  }
} finally {
  await db.destroy()
}
