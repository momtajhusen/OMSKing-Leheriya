export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (relative && !/\.(js|jsx|json|mjs|cjs)$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      return nextResolve(`${specifier}.jsx`, context);
    }
  }
  return nextResolve(specifier, context);
}
