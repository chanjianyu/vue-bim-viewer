import { cp } from 'node:fs/promises'

await cp(new URL('../types/', import.meta.url), new URL('../dist/', import.meta.url), {
  recursive: true,
})
