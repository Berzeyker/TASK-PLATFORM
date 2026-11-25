/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from 'express';

/**
 * Every "METHOD /path" the Express app registers, with params normalized to `:p`.
 * Lets the permission matrix prove it covers all routes: a new route without a matrix entry fails the build.
 */
export function listRoutes(app: Express): string[] {
  const found = new Set<string>();
  const mountPath = (layer: any): string =>
    layer.regexp.source.replace('^', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');

  const walk = (stack: any[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          found.add(`${method.toUpperCase()} ${normalize(prefix + layer.route.path)}`);
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };
  walk((app as any)._router.stack, '');
  return [...found].sort();
}

export const normalize = (route: string): string => route.replace(/:[A-Za-z]+/g, ':p').replace(/(.)\/$/, '$1');
