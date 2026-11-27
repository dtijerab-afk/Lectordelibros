import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('dist');
const destination = path.resolve('public', '__app');

await rm(destination, { recursive: true, force: true });
await mkdir(path.dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });

console.log('Vite assets copied to public/__app for Vercel static delivery.');
