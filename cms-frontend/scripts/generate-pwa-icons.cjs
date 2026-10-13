/* 从 public/favicon.svg 生成 PWA 所需的 PNG 图标。
 *
 * 用法：
 *   npm i -D @resvg/resvg-js
 *   node scripts/generate-pwa-icons.cjs
 *
 * 图标源文件是纯 path 图形（不含文字），无需系统字体即可渲染。
 */

const fs = require('fs');
const path = require('path');

let Resvg;
try {
  ({ Resvg } = require('@resvg/resvg-js'));
} catch {
  console.error('缺少依赖 @resvg/resvg-js，请先执行： npm i -D @resvg/resvg-js');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const srcPath = path.join(root, 'public', 'favicon.svg');
const outDir = path.join(root, 'public', 'icons');

if (!fs.existsSync(srcPath)) {
  console.error('找不到源图标：', srcPath);
  process.exit(1);
}

const source = fs.readFileSync(srcPath, 'utf8');
// 去掉外层 <svg> 标签，只保留内部图形（含 defs 里的渐变）
const body = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');

const BG = '#f0fdf5';

/** 把 64x64 的源图形居中放入 size×size 画布，scale 控制留白比例 */
function compose(size, scale) {
  const inner = size * scale;
  const offset = (size - inner) / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" fill="${BG}"/>`,
    `<g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${(inner / 64).toFixed(4)})">${body}</g>`,
    '</svg>',
  ].join('');
}

const TARGETS = [
  // file,                size, scale, 说明
  ['icon-192.png', 192, 0.88, 'Android 桌面图标（any）'],
  ['icon-512.png', 512, 0.88, 'Android 启动画面（any）'],
  ['icon-maskable-512.png', 512, 0.74, 'Android 自适应图标，内容收在 80% 安全区内'],
  ['apple-touch-icon.png', 180, 0.82, 'iOS 添加到主屏幕（系统会自动加圆角）'],
];

fs.mkdirSync(outDir, { recursive: true });

for (const [file, size, scale, note] of TARGETS) {
  const svg = compose(size, scale);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(`✓ ${file.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB  ${note}`);
}

// manifest 里的 SVG 兜底图标
fs.copyFileSync(srcPath, path.join(outDir, 'icon.svg'));
console.log(`✓ ${'icon.svg'.padEnd(24)} 矢量     —      浏览器可直接缩放`);

console.log(`\n输出目录：${outDir}`);
