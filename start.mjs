// Run this file directly in production so Node receives termination signals.
process.env.NODE_ENV = 'production';
await import('./server.mjs');
