import app from '../server.ts';

// Catch every nested /api/* request and pass it to the Express router.
// This makes routes such as /api/analyze, /api/quiz and /api/chat
// available as one Vercel serverless function.
export default app;
