import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const publicDir = path.resolve('public');

await mkdir(path.join(publicDir, 'assets'), { recursive: true });
await cp(path.join(distDir, 'assets'), path.join(publicDir, 'assets'), {
  recursive: true,
  force: true,
});
await cp(path.join(distDir, 'index.html'), path.join(publicDir, 'index.html'));

console.log('Vite frontend copied to Vercel public directory.');
