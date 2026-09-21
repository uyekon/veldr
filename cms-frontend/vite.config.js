import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_CMS_FRONTEND_PORT || 5174);
  const apiBase = env.VITE_BACKEND_BASE_URL || 'http://localhost:5000';
  const base = env.VITE_CMS_BASE_PATH || '/';

  return {
    // 测试站可挂载到反向代理子路径；未设置时仍保持生产根路径。
    base,
    server: {
      port,
      host: '0.0.0.0',
      // 允许测试入口经 cms.lifetip.top 的 Nginx 反向代理访问。
      allowedHosts: ['cms.lifetip.top'],
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: apiBase,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
