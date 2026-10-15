import { pathToFileURL } from "node:url";

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const projectRoot = pathToFileURL(`${process.cwd()}/`);
    return nextResolve(`${new URL(`./src/${specifier.slice(2)}`, projectRoot).href}.ts`, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !specifier.match(/\.[a-z]+$/i)) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
