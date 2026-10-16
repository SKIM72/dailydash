import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 개발 중에는 /api 요청을 로컬 백엔드(server/, 기본 3000번 포트)로 넘긴다.
const apiTarget = process.env.DAILYDASH_API_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': apiTarget
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': apiTarget
    }
  },
  build: {
    // 엑셀 라이브러리 청크(약 870KB)는 다운로드 버튼을 누를 때만 불러오므로 경고 기준을 올린다.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html')
      }
    }
  }
});
