import type { StorybookConfig } from "@storybook/react-vite";
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx", "../src/**/*.mdx"],
  addons: ["@storybook/addon-docs"],
  framework: "@storybook/react-vite",
  core: { disableTelemetry: true },
  build: {
    test: {
      // Keep every story and documentation entry. CI does not need generated
      // prop tables or source maps; the published Storybook still includes them.
      disabledAddons: [],
      disableDocgen: true,
      disableSourcemaps: true,
      disableBlocks: false,
      disableMDXEntries: false,
      disableAutoDocs: false,
      disableTreeShaking: false,
    },
  },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    resolve: {
      ...viteConfig.resolve,
      dedupe: Array.from(new Set(["react", "react-dom", ...(viteConfig.resolve?.dedupe ?? [])])),
    },
  }),
};
export default config;
