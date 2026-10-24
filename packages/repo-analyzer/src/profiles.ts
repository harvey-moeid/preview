/** Detection never evaluates repository configuration or imports target code. */
export interface Profile {
  id: string;
  framework: string;
  dependencies: string[];
  runtime: "static" | "disabled";
  output: string;
  spa: boolean;
}
export const profiles: readonly Profile[] = [
  {
    id: "next-runtime",
    framework: "Next.js (runtime gated)",
    dependencies: ["next"],
    runtime: "disabled",
    output: "out",
    spa: false,
  },
  {
    id: "nuxt-runtime",
    framework: "Nuxt (runtime gated)",
    dependencies: ["nuxt"],
    runtime: "disabled",
    output: ".output/public",
    spa: false,
  },
  {
    id: "sveltekit-runtime",
    framework: "SvelteKit (runtime gated)",
    dependencies: ["@sveltejs/kit"],
    runtime: "disabled",
    output: "build",
    spa: false,
  },
  {
    id: "astro-static",
    framework: "Astro (static)",
    dependencies: ["astro"],
    runtime: "static",
    output: "dist",
    spa: false,
  },
  {
    id: "vite-static",
    framework: "Vite",
    dependencies: ["vite"],
    runtime: "static",
    output: "dist",
    spa: true,
  },
  {
    id: "angular-static",
    framework: "Angular (manual output)",
    dependencies: ["@angular/core"],
    runtime: "static",
    output: "dist",
    spa: true,
  },
];
export function profileFor(
  deps: Record<string, string>,
  hasBuild: boolean,
): Profile {
  return (
    profiles.find((p) => p.dependencies.some((dep) => dep in deps)) || {
      id: hasBuild ? "custom-static" : "html-static",
      framework: hasBuild ? "Custom static" : "HTML",
      dependencies: [],
      runtime: "static",
      output: hasBuild ? "dist" : ".",
      spa: false,
    }
  );
}
