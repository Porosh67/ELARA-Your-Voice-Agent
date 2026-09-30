import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {};", shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const base = new URL(specifier.slice(2), ROOT);
    const withoutSuffix = fileURLToPath(base);

    for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
      const candidate = suffix === "" ? withoutSuffix : withoutSuffix + suffix;

      if (existsSync(candidate)) {
        return {
          url: suffix === "" ? base.href : `${base.href}${suffix}`,
          shortCircuit: true,
        };
      }
    }
  }

  return nextResolve(specifier, context);
}
