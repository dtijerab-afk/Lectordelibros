import { rm } from 'node:fs/promises';
import path from 'node:path';

const publicDir = path.resolve('public');

await rm(path.join(publicDir, '__app'), { recursive: true, force: true });
await rm(path.join(publicDir, 'index.html'), { force: true });

console.log('Removed generated Vercel public files before Vite build.');
