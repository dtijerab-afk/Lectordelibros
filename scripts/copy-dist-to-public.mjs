import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('dist');
const publicDir = path.resolve('public');
const assetDestination = path.join(publicDir, '__app');

await rm(assetDestination, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
await cp(source, assetDestination, { recursive: true });
await cp(path.join(source, 'index.html'), path.join(publicDir, 'index.html'));

console.log('Vercel static assets prepared in public/.');
