import type { Plugin } from 'vite';

/** The source of the offline service worker for the given files. */
export function workerSource(files: readonly string[], version: string): string;
/** The Vite plugin that writes sw.js into the built game. */
export function offline(): Plugin;
