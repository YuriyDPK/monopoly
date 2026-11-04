import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

// Resolve the same local TypeScript imports as Next.js, without a separate test dependency.
const root = new URL('../', import.meta.url);
registerHooks({
  load(url, context, nextLoad) {
    return nextLoad(url, url.startsWith(root.href) && url.endsWith('.ts') ? { ...context, format: 'module-typescript' } : context);
  },
  resolve(specifier, context, nextResolve) {
    let target;
    if (specifier.startsWith('@/')) target = new URL(specifier.slice(2), root);
    else if (specifier.startsWith('.') && context.parentURL) target = new URL(specifier, context.parentURL);
    if (target && !/\.[a-z]+$/i.test(target.pathname)) {
      const source = new URL(`${target.href}.ts`);
      if (existsSync(source)) return nextResolve(source.href, context);
    }
    return nextResolve(specifier, context);
  },
});
