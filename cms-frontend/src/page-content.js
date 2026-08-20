// ===== 内置页面内容（API / 指南，后端按 contentKey 引用）=====
export const PAGE_CONTENT = {
  api: `
<div class="page-view__title">API 参考文档</div>
<p>NoteFlow 提供 RESTful API 接口，方便开发者将笔记系统集成到自己的工作流中。</p>

<h2>基础信息</h2>
<p><strong>Base URL</strong>：<code>/api/cms</code></p>
<p><strong>数据持久化</strong>：服务端 JSON 文件（data/db.json），部署后所有数据统一保存在服务器。</p>

<h2>接口列表</h2>

<h3>获取笔记列表</h3>
<pre><code>GET /api/cms/notes?category=work&tag=frontend</code></pre>
<p><strong>参数说明</strong>：</p><ul><li><code>category</code> — 按分类筛选（work / learn）</li><li><code>tag</code> — 按标签筛选</li><li><code>star</code> — 1 仅收藏</li><li><code>search</code> — 关键词搜索</li></ul>

<h3>获取单篇笔记</h3>
<pre><code>GET /api/cms/notes/:id</code></pre>
<p>返回笔记的完整内容，包括 Markdown 正文。</p>

<h3>创建笔记</h3>
<pre><code>POST /api/cms/notes
Content-Type: application/json

{
  "title": "新笔记标题",
  "category": "work",
  "tags": ["frontend", "react"],
  "content": "# Markdown 内容..."
}</code></pre>

<h3>更新笔记</h3>
<pre><code>PUT /api/cms/notes/:id
Content-Type: application/json

{
  "title": "更新后的标题",
  "starred": true
}</code></pre>

<h3>删除笔记</h3>
<pre><code>DELETE /api/cms/notes/:id</code></pre>

<h3>菜单接口</h3>
<pre><code>GET    /api/cms/menus        # 获取菜单列表
POST   /api/cms/menus        # 新增菜单  { "label": "新页面" }
PUT    /api/cms/menus/:id     # 重命名    { "label": "新名称" }
DELETE /api/cms/menus/:id     # 删除菜单</code></pre>

<h3>上传图片</h3>
<pre><code>POST /api/cms/upload
Content-Type: multipart/form-data

# 表单字段 image：图片文件（png/jpg/gif/webp/svg/avif/bmp，≤ 20MB）
# 返回 { "url": "/uploads/cms/xxx.png", "name": "原文件名" }</code></pre>
<p>上传成功后，在笔记正文中使用 <code>![图片说明](/uploads/cms/xxx.png)</code> 引用即可（编辑框的「插入图片」按钮会自动完成这一步）。</p>

<h2>错误码</h2>
<table style="width:100%;border-collapse:collapse;font-size:.9375rem;color:var(--c600);margin:var(--s4) 0">
<tr style="background:var(--c100);text-align:left"><th style="padding:10px 12px;font-weight:600">状态码</th><th style="padding:10px 12px;font-weight:600">说明</th></tr>
<tr><td style="padding:10px 12px;border-bottom:1px solid var(--c200)"><code>200</code></td><td style="padding:10px 12px;border-bottom:1px solid var(--c200)">成功</td></tr>
<tr><td style="padding:10px 12px;border-bottom:1px solid var(--c200)"><code>201</code></td><td style="padding:10px 12px;border-bottom:1px solid var(--c200)">创建成功</td></tr>
<tr><td style="padding:10px 12px;border-bottom:1px solid var(--c200)"><code>400</code></td><td style="padding:10px 12px;border-bottom:1px solid var(--c200)">请求参数错误</td></tr>
<tr><td style="padding:10px 12px;border-bottom:1px solid var(--c200)"><code>404</code></td><td style="padding:10px 12px;border-bottom:1px solid var(--c200)">资源不存在</td></tr>
<tr><td style="padding:10px 12px"><code>500</code></td><td style="padding:10px 12px">服务器错误</td></tr>
</table>
`,
  guide: `
<div class="page-view__title">使用指南</div>
<p>快速上手 NoteFlow，了解如何高效管理你的个人知识库。所有数据保存在服务器端，刷新或更换设备都不会丢失。</p>

<h2>创建第一篇笔记</h2>
<p>点击顶部导航栏的<strong>"新建笔记"</strong>按钮（或使用快捷键），填写标题、选择分类和标签，然后使用 Markdown 格式编写内容。</p>

<div class="callout callout--info">
  <div class="callout__title">💡 Markdown 快捷参考</div>
  <div class="callout__content">
    <strong>#</strong> 一级标题 | <strong>##</strong> 二级标题 | <strong>**粗体**</strong> | <strong>*斜体*</strong><br>
    <strong>- 列表</strong> | <strong>1. 有序列表</strong> | <strong>\`代码\`</strong> | <strong>\`\`\`代码块</strong><br>
    <strong>📷 插入图片</strong>：点击编辑框上方的「插入图片」按钮上传，自动以 <code>![名称](/uploads/cms/xxx.png)</code> 插入当前光标处
  </div>
</div>

<h2>组织笔记</h2>

<h3>分类管理</h3>
<p>每篇笔记属于一个分类（工作 / 学习），点击左侧边栏的分类可以快速筛选。</p>

<h3>标签系统</h3>
<p>使用标签进一步细化笔记主题。标签会显示在左侧边栏，点击即可筛选。一篇笔记可以添加多个标签（用逗号分隔）。</p>

<h3>收藏夹</h3>
<p>重要笔记可以加入收藏夹，方便快速查找。在笔记详情页或卡片上点击星标按钮即可。</p>

<h2>搜索笔记</h2>
<p>使用顶部搜索框（快捷键 <code>Ctrl+K</code>）可以搜索标题、标签和正文内容。搜索结果实时更新。</p>

<h2>自定义顶部菜单</h2>
<ul>
  <li><strong>编辑菜单名称</strong>：双击菜单项，输入新名称后按回车确认</li>
  <li><strong>添加新菜单</strong>：点击菜单栏末尾的 <strong>"+ 添加"</strong> 按钮</li>
  <li><strong>删除菜单</strong>：将鼠标悬停在菜单项上，点击右上角的 ✕ 按钮</li>
</ul>

<h2>部署与数据</h2>
<p>本应用是前后端一体服务。所有笔记与菜单配置保存在服务器 <code>data/db.json</code> 文件中。部署到服务器后，可通过反向代理（Nginx / Caddy）对外提供服务。</p>

<h2>快捷键</h2>
<table style="width:100%;border-collapse:collapse;font-size:.9375rem;color:var(--c600);margin:var(--s4) 0">
<tr style="background:var(--c100);text-align:left"><th style="padding:10px 12px;font-weight:600">快捷键</th><th style="padding:10px 12px;font-weight:600">功能</th></tr>
<tr><td style="padding:10px 12px;border-bottom:1px solid var(--c200)"><code>Ctrl+K</code></td><td style="padding:10px 12px;border-bottom:1px solid var(--c200)">聚焦搜索框</td></tr>
<tr><td style="padding:10px 12px;border-bottom:1px solid var(--c200)"><code>Esc</code></td><td style="padding:10px 12px;border-bottom:1px solid var(--c200)">返回笔记列表 / 关闭弹窗</td></tr>
<tr><td style="padding:10px 12px;border-bottom:1px solid var(--c200)"><code>Ctrl+N</code></td><td style="padding:10px 12px;border-bottom:1px solid var(--c200)">新建笔记</td></tr>
<tr><td style="padding:10px 12px"><code>双击菜单</code></td><td style="padding:10px 12px">编辑菜单名称</td></tr>
</table>
`,
};
