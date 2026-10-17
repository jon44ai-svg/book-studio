import os from 'node:os'
import { defineCollection, defineConfig } from '@content-collections/core'
import { z } from 'zod'

// ponytail: Termux/Android reports os.cpus() as [], which makes content-collections
// pass concurrency 0 to p-limit and crash. Fill the list from availableParallelism.
if (os.cpus().length === 0) {
  const count = os.availableParallelism?.() ?? 1
  os.cpus = () => Array.from({ length: count }, () => ({ model: 'unknown', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }))
}

const speakers = defineCollection({
  name: 'speakers',
  directory: 'content/speakers',
  include: '**/*.md',
  schema: z.object({
    name: z.string(),
    title: z.string(),
    specialty: z.string(),
    restaurant: z.string(),
    location: z.string(),
    headshot: z.string(),
    awards: z.array(z.string()).optional(),
    content: z.string(),
  }),
  transform: async (doc) => {
    return {
      ...doc,
      slug: doc.name
        .toLowerCase()
        .replace(/[^\w-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    }
  },
})

const talks = defineCollection({
  name: 'talks',
  directory: 'content/talks',
  include: '**/*.md',
  schema: z.object({
    title: z.string(),
    speaker: z.string(),
    duration: z.string(),
    image: z.string(),
    topics: z.array(z.string()),
    content: z.string(),
  }),
  transform: async (doc) => {
    return {
      ...doc,
      slug: doc.title
        .toLowerCase()
        .replace(/[^\w-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, ''),
    }
  },
})

export default defineConfig({
  collections: [speakers, talks],
})
