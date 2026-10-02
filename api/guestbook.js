import { createHandler } from '../lib/guestbook.mjs';
let sql;
export default {
  fetch: createHandler(async () => {
    if (!sql) {
      const { neon } = await import('@neondatabase/serverless');
      const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_URL;
      if (!url) throw new Error('Database configuration missing');
      sql = neon(url);
    }
    return sql;
  })
};
