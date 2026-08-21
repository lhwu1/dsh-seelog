import { defineConfig } from 'tsdown'

const platform = [
  'react', 'react/jsx-runtime', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-query', '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-client-locale/client', '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-conversation/client', '@deepseek-ai/dsh-client-ui-slots',
]

export default defineConfig([
  {
    entry: { index: 'src/host/index.ts', web: 'src/host/web.ts' },
    outDir: 'lib/host',
    format: ['esm'],
    platform: 'node',
    external: [/^@deepseek-ai\//, /^node:/],
    sourcemap: true,
    dts: true,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    external: platform,
    noExternal: (id: string) => platform.includes(id) ? undefined : true,
    sourcemap: true,
    clean: false,
    dts: false,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-seelog", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
