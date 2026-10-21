import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
await rm('public', { recursive: true, force: true });
await mkdir('public');
for (const entry of await readdir('.', { withFileTypes: true })) {
  const directories = ['assets', 'about', 'books', 'she-said-hi', 'guestbook-admin', 'subscribers-admin', 'author-help', 'author-help-admin', 'news'];
  const staticFile = entry.isFile() && /\.(html|txt|xml|jpg|jpeg|png|webp|svg|ico|avif)$/i.test(entry.name);
  if (staticFile || (entry.isDirectory() && directories.includes(entry.name))) {
    await cp(entry.name, `public/${entry.name}`, { recursive: true });
  }
}
const coverB64 = await readFile('assets/solon-cover.b64', 'utf8');
await writeFile('public/assets/solon-cover.jpg', Buffer.from(coverB64.replace(/\s+/g, ''), 'base64'));
await rm('public/assets/solon-cover.b64', { force: true });
console.log('Static website copied to public. API code stays server-side.');
