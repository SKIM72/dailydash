import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { iconSvg } from './src/shared/icons.js';

// 개발 중에는 /api 요청을 로컬 백엔드(server/, 기본 3000번 포트)로 넘긴다.
const apiTarget = process.env.DAILYDASH_API_URL || 'http://127.0.0.1:3000';

// HTML 의 <i data-icon="..."></i> 자리표시를 빌드할 때 SVG 로 바꿔, 첫 화면부터 아이콘이 바로 보이게 한다.
function inlineIcons() {
  const placeholder = /<i\s+([^>]*\bdata-icon="[^"]+"[^>]*)><\/i>/g;
  return {
    name: 'dailydash-inline-icons',
    transformIndexHtml(html) {
      return html.replace(placeholder, (match, rawAttrs) => {
        const attrs = Object.fromEntries([...rawAttrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
        return iconSvg(attrs['data-icon'], {
          variant: attrs['data-variant'] || 'bulk',
          className: attrs.class || '',
          label: attrs['aria-label'] || ''
        });
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [inlineIcons()],
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
        login: resolve(__dirname, 'login.html'),
        install: resolve(__dirname, 'install.html')
      }
    }
  }
});
