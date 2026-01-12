import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Plugin to remove X-Frame-Options and add permissive CSP for iframe embedding
function allowIframePlugin(): Plugin {
  return {
    name: 'allow-iframe',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        // Remove restrictive headers that block iframe embedding
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', "frame-ancestors *");
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    allowIframePlugin(),
    svelte(),
    viteSingleFile(), // Bundle everything into a single HTML file
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 100000000, // Inline all assets
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
