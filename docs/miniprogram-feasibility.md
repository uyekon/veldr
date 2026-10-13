# Veldr / NoteFlow 构建为微信小程序 —— 可行性评估与适配方案

> 评估时间：2026-10-12（v2，**基线已修正**）
> 前端基线：**仅 `cms-frontend`**（NoteFlow CMS UI），**不含 `frontend/`（Veldr Vue 端）**
> 主体类型：**个人主体**
> 目标平台：微信小程序

---

## 0. 基线修正带来的结论变化

| 项 | v1 假设（frontend + 企业主体） | **v2 实际（cms-frontend + 个人主体）** |
| --- | --- | --- |
| 前端框架 | Vue 3 SFC，uni-app 可直接搬 | **原生 JS（Vanilla）+ Vite 8，无框架**，无 SFC 可搬 |
| 前端复用度 | ≈60% | **≈35%**（可复用集中在纯逻辑层） |
| 富文本编辑器 | TinyMCE | **Tiptap 3 + ProseMirror**（同样依赖 DOM，仍不可用） |
| 内容格式 | HTML，建议迁 Markdown | **已是 Markdown 一等公民**（`@tiptap/markdown` + `marked`），这是最大优势 |
| 套壳（web-view） | 企业主体可用 | **个人主体不可用，彻底出局** |
| 类目合规 | 无阻塞 | **「网络社交 - 笔记」类目个人备案"不建议选择"，是本项目最大合规风险** |
| 视频功能 | 无 | **`/api/media` 视频库必须砍掉** |

---

## 1. cms-frontend 现状盘点

### 1.1 技术栈（**无框架，这是关键**）

```
cms-frontend/
├─ index.html          # 全部 CSS 内联（~2000 行 design tokens + 组件样式）
├─ src/
│  ├─ main.js          # 入口，30 处 DOM 操作
│  ├─ config.js        # 读 window.CMS_CONFIG（部署时由 deploy-frontends.ps1 注入）
│  ├─ markdown-runtime.js   # marked + DOMPurify → HTML 字符串
│  ├─ markdown-utils.js     # 纯函数，0 DOM ✅
│  ├─ structured-markdown.js# 纯函数，0 DOM ✅
│  ├─ page-content.js       # 纯函数，0 DOM ✅
│  └─ app/
│     ├─ api.js / auth.js / router.js / ui.js / state.js
│     ├─ notes-view.js / categories.js / menus.js / delegate.js
│     ├─ editor.js / rich-editor.js / drafts.js
│     ├─ media.js / video-upload.js / whiteboard.js
└─ vite.config.js      # Vite 8，仅 proxy + base，无插件
```

依赖：`@tiptap/*`（core / starter-kit / markdown / image / table / task-list / file-handler）、`marked@18`、`dompurify@3`。

**没有任何 Vue / React / Svelte。** 页面是字符串模板 + `innerHTML` 拼出来的，路由是 hash 路由。

### 1.2 浏览器 API 依赖密度（实测统计）

对 `innerHTML | document. | window. | localStorage | sessionStorage` 的命中计数：

| 文件 | 命中数 | 判定 |
| --- | --- | --- |
| `app/editor.js` | 56 | ❌ 重写 |
| `app/whiteboard.js` | 34 | ❌ 重写 |
| `app/notes-view.js` | 32 | ❌ 重写 |
| `main.js` | 30 | ❌ 重写 |
| `app/menus.js` | 26 | ❌ 重写 |
| `app/auth.js` | 25 | ❌ 重写 |
| `app/categories.js` | 23 | ❌ 重写 |
| `app/ui.js` | 15 | ❌ 重写 |
| `app/delegate.js` | 12 | ❌ 重写 |
| `app/media.js` | 7 | ❌ 重写 |
| `markdown-runtime.js` | 6 | ⚠️ 部分可救 |
| `app/api.js` | 2 | ⚠️ 替换 fetch |
| `app/router.js` | 1 | ❌ 重写 |
| `config.js` | 2 | ⚠️ 改常量 |
| **`markdown-utils.js`** | **0** | ✅ **直接复用** |
| **`structured-markdown.js`** | **0** | ✅ **直接复用** |
| **`page-content.js`** | **0** | ✅ **直接复用** |
| **`app/state.js`** | **0** | ✅ **直接复用** |
| **`app/video-upload.js`** | **0** | ✅ 直接复用（校验逻辑） |
| `app/drafts.js` | 1 | ✅ 近乎直接复用 |

**合计 239 处浏览器 API 命中。** 但结构很清楚：**视图层全废，逻辑层全活**。

### 1.3 真正可复用的资产（这是本项目最有价值的部分）

| 模块 | 导出 | 小程序端价值 |
| --- | --- | --- |
| `markdown-utils.js` | `normalizeMarkdownStructure` / `normalizeImageWidths` / `promoteIndentedImageBlocks` / `normalizeEscapedImageMarkdown` / `IMAGE_WIDTHS` | **图片宽度语法、`:::indent` 归一**——保证小程序端与 Web 端渲染一致 |
| `structured-markdown.js` | `extractStructuredBlocks` / `indentLevel` | 解析自定义块（`:::indent`、`toggle` 等），towxml 需据此做自定义节点 |
| `page-content.js` | — | 自定义页面渲染 |
| `app/state.js` | 状态模型 | 可直接作为全局 store 蓝本 |
| `app/drafts.js` | `saveDraft` / `loadDraft` / `isDraftNewerThanNote` | 草稿本地存储，改成 `wx.setStorageSync` 即可 |

这些文件**都带 vitest 测试**（`markdown-utils.test.js`、`structured-markdown.test.js`、`notes-tags.test.js`、`notebook-categories.test.js`、`editor-save.test.js` 等），搬运后可立即验证，风险最低。

### 1.4 后端 CMS 接口（`backend/modules/cms/cmsRoutes.js`，672 行）

| 方法 | 路径 | 权限 | 小程序端 |
| --- | --- | --- | --- |
| GET | `/api/cms/me` | viewer | ✅ |
| GET | `/api/cms/notes` | viewer | ✅ |
| GET | `/api/cms/notes/:id` | viewer | ✅ |
| POST/PUT/DELETE | `/api/cms/notes[/:id]` | editor | ✅ |
| GET/POST/PUT/DELETE | `/api/cms/categories` | viewer/editor | ✅ |
| GET/POST/PUT/DELETE | `/api/cms/menus` | viewer/editor | ✅ |
| GET/PUT | `/api/cms/whiteboard[s]` | editor | ⚠️ 建议砍 |
| GET/POST/DELETE | `/api/cms/media` | viewer/editor | ❌ **必须砍** |
| POST | `/api/cms/upload` | editor | ✅ |
| GET | `/api/cms/export` | editor | ❌ 小程序无下载到本地 |

**好消息**：`backend/modules/cms/cmsAuth.js` 直接复用 `req.auth`（Veldr 的 `attachAuthState`），因此 CMS 命名空间**天然继承 Bearer Token 支持**，与 Veldr 主命名空间一致。

---

## 2. 可行性结论（个人主体）

| 维度 | 结论 |
| --- | --- |
| **后端复用度** | **≈95%**，改动极小 |
| **前端复用度** | **≈35%**：逻辑层几乎全搬（Markdown 语义、草稿、状态），视图层几乎全废 |
| **技术可行性** | ✅ **可行**，但工作量比 v1 估计**更大**（无框架红利） |
| **合规可行性** | ⚠️ **有条件可行**——取决于能否把产品定位收敛为"仅本人使用的私人备忘录工具" |
| **最大阻塞项** | ① 个人主体 + 「笔记」类目冲突；② web-view 被封死；③ Tiptap 编辑器不可用；④ DOMPurify 无法在小程序运行 |
| **推荐路线** | **uni-app（Vue 3）新建 `mp/` 工程**，页面用 Vue 重写；Markdown 逻辑层直接 import 复用 |
| **推荐范围** | **MVP = 登录 + 笔记列表 + 详情阅读 + 纯文本/Markdown 编辑**。白板、视频、导出、图片画廊全部砍掉 |

---

## 3. 个人主体的硬性限制（这些直接决定产品形态）

### 3.1 致命项

| 限制 | 依据 | 后果 |
| --- | --- | --- |
| **web-view / 业务域名仅非个人主体** | 微信官方文档：业务域名"仅支持非个人主体类型的小程序配置" | **H5 套壳方案彻底出局**，必须真写小程序 |
| **「网络社交 - 笔记」类目个人备案"不建议选择"** | 微信《小程序备案服务内容选择指引》：笔记 = "用户自定义内容发布与分享，**且他人可见/访问**"，**个人备案：不建议选择** | 一旦产品形态是"可分享、他人可见的笔记"，过不了备案。**必须收敛为仅本人可见** |
| **「视频」类目个人备案"不建议选择"** | 同上，且需《信息网络传播视听节目许可证》 | **`/api/media` 视频库必须砍掉**（当前允许 500MB 视频上传） |
| 微信支付 | 需企业商户号 | 本项目不涉及，无影响 |
| `wx.getPhoneNumber` | 需企业认证 | 本项目用自有账号密码，无影响 |

### 3.2 必须满足的前置条件

1. **域名 ICP 备案 + HTTPS**。当前 CMS 前端配置里出现 `cms.lifetip.top`，需确认该域名已完成备案且启用 HTTPS；未备案域名无法配置为小程序服务器域名。
2. **服务类目选「工具」大类下的效率/备忘录方向**，且**产品功能不得超出"个人工具"范围**。
3. **必须提供隐私政策**（个人小程序同样强制）。
4. **审核需提供测试账号**。本项目是单密码系统 —— 给审核员密码 = 暴露私人笔记。**建议内置一个只读"演示模式"（假数据），或明确在审核备注中说明并提供专用演示密码。**
5. **内容安全**：即使是私人笔记，只要有"写"的能力，审核方会要求内容安全机制。`wx.msgSecCheck` / `imgSecCheck` 个人主体可用，建议接入。

### 3.3 为了过审，产品形态必须做的收敛

| 现有能力 | 处置 | 原因 |
| --- | --- | --- |
| 公开笔记浏览（viewer 模式可看非 private 笔记） | **改为：未登录看不到任何内容** | 避免"他人可见" |
| hash 路由分享链接（`#/note/123`） | **不做分享**，或分享后对方仍需登录 | 避免"分享传播" |
| 视频库 / 视频插入 | **砍掉** | 类目 + 许可证 |
| 白板（`whiteboard.js`） | **砍掉**（34 处 DOM，重写成本高，价值低） | 投入产出比 |
| 导出 zip / 导出 md（`exportNotes`） | **砍掉** | 小程序无本地文件系统下载 |
| 图片画廊（多列布局 `MAX_GALLERY_COLUMNS`） | 保留但简化 | 可控 |

---

## 4. 不兼容依赖清单

### 4.1 完全不可用

| 依赖 / 模块 | 原因 | 替代 |
| --- | --- | --- |
| **`@tiptap/*` 全家桶** | ProseMirror 强依赖 DOM、`contentEditable`、`document` | ① 小程序原生 `editor` 组件（能力弱，无表格/任务列表）② **推荐：`textarea` + Markdown 工具栏** 自研简易编辑器 |
| **DOMPurify** | 需要 `window` / `document` 才能初始化 | **净化必须下沉到后端**（见 §5.3，这是安全硬要求） |
| **`marked`** | 本身是纯 JS，**可用** ✅，但输出 HTML 字符串后无法 `innerHTML` | 保留 `marked` 做解析？不如直接用 **towxml**（Markdown → 小程序节点树） |
| **`config.js` 的 `window.CMS_CONFIG`** | 无 `window.CMS_CONFIG` 注入机制 | 改为构建时常量 / `env` 文件 |
| **Google Fonts（Geist / Geist Mono）** | 小程序不支持外链字体 | 改用系统字体栈（`system-ui, -apple-system`） |
| **hash 路由** | 小程序无 `location.hash` | `pages.json` + `uni.navigateTo` |
| **`fetch` + `credentials: 'include'`** | 无 fetch，无 Cookie jar | `uni.request` + `Authorization: Bearer` |
| **`AbortSignal.timeout(30000)`** | 小程序支持有限 | `uni.request` 的 `timeout` 参数 |
| **`document.createElement('a')` 触发下载**（`exportNotes`） | 无 | 砍掉 |
| **CSS**：`backdrop-filter`、`position: fixed` 顶栏、`100dvh`、`:root` 变量级联到子组件 | 小程序 WXSS 支持 CSS 变量但 **不支持 `*` 通配**、部分伪类、`backdrop-filter` 表现不一致 | 逐条替换 |
| **内联 CSP meta**（index.html） | 小程序无此概念，但也无 XSS 风险来源 | 移除 |

### 4.2 需适配

| 项 | 改为 |
| --- | --- |
| `localStorage`（auth 状态、`app/drafts.js`） | `uni.setStorageSync` |
| `window.addEventListener('storage' / 'hashchange')` | 删除，改为 Pinia 响应式 |
| `document.getElementById(...).style.display` 的角色 UI 切换 | Vue `v-if` / class 绑定 |
| `AbortSignal.timeout` | `uni.request({ timeout })` |
| 事件委托（`app/delegate.js` 的 `data-action`） | Vue 事件绑定 |
| `FormData` 上传 | `uni.uploadFile({ name, filePath })` |
| `escapeHTML` 手写转义（多处） | 保留（纯函数），但不作为 XSS 唯一防线 |

---

## 5. 需改造的关键模块

### 5.1 鉴权（改造成本：低）

```
现状（Web）                          目标（小程序）
POST /api/auth/login                 POST /api/auth/login
  { username, password }               { username, password, client: 'veldr-mp' }
        ↓                                    ↓
Set-Cookie: veldr_auth (httpOnly)      响应体 { accessToken }
        ↓                                    ↓
fetch credentials:'include'           uni.setStorageSync('veldr_token')
                                             ↓
                                      header: authorization: Bearer <token>
```

后端改动与 v1 相同（2 处小改）：
- `passwordController.js`：`client === 'noteflow-mobile'` → 白名单集合（增 `veldr-mp`）
- `config/index.js`：CORS origin 放行（小程序 Origin 为 `https://servicewechat.com`）

`cmsAuth.js` 的 `requireEditor` 走 `req.auth.isAuthenticated`，**无需改动** ✅

### 5.2 编辑器（改造成本：高，且决定 MVP 成败）

Tiptap 不可用。**推荐方案：Markdown 纯文本编辑器**

```
┌─ 编辑页 ──────────────────────┐
│ [textarea] 原生多行输入        │  ← 直接写 Markdown
│                                │
│ [图片][粗体][标题][列表][任务] │  ← 工具栏：插入 Markdown 语法片段
│                                │
│ [预览] ← 切换 → towxml 渲染    │
└────────────────────────────────┘
```

理由：
- 后端存的本来就是 Markdown（`@tiptap/markdown` 双向转换），**不需要额外迁移**
- `textarea` 在小程序中是原生组件，输入体验尚可
- 工具栏只需字符串插入，实现简单
- 代价：失去所见即所得、表格编辑、拖拽图片 —— 但这些都是"nice to have"

**不要**用小程序原生 `editor` 组件：它产出 HTML，与后端 Markdown 存储需要二次转换，且不支持表格/任务列表，反而更复杂。

### 5.3 Markdown 渲染与 XSS 净化（**新增的安全约束**）

现状管线：`Markdown → marked → DOMPurify.sanitize → HTML → innerHTML`

小程序端无法运行 DOMPurify。**XSS 净化必须下沉到后端**，否则反序列化他人内容（多端同步场景）时存在注入风险。

```
POST/PUT /api/cms/notes
   ↓
后端新增：sanitize-note-content(content)   ← 用 sanitize-html 或 dompurify+jsdom
   ↓
存储
```

后端已有 `dompurify` 吗？没有（只在 cms-frontend）。建议后端新增 `sanitize-html` 依赖，在 `cmsRoutes.js` 的 `POST /notes`、`PUT /notes/:id` 入口做统一净化。**这是本次改造唯一需要在后端"新增逻辑"的地方，不能省。**

小程序端渲染：`towxml`（Markdown → 小程序节点），配合 `markdown-utils.js` 的归一化函数保证与 Web 端一致。

### 5.4 视图层重写清单

| Web 模块 | 小程序页面 | 工作量 |
| --- | --- | --- |
| `main.js` + `index.html` 内联 CSS | `App.vue` + `pages.json` | 中 |
| `app/auth.js` 登录浮层 | `pages/auth/auth` | 小 |
| `app/notes-view.js` 列表 + 详情 + TOC | `pages/list/list`、`pages/detail/detail` | **大** |
| `app/categories.js` / `menus.js` | 侧边筛选，可简化为顶部 tab | 中 |
| `app/editor.js` + `rich-editor.js` | `pages/edit/edit` | **大** |
| `app/ui.js` toast / modal / loading | `uni.showToast` / 自定义组件 | 小 |
| `app/drafts.js` | 直接复用 + Storage 适配 | 小 |
| `app/whiteboard.js` | **砍掉** | — |
| `app/media.js` + `video-upload.js` | **砍掉** | — |

---

## 6. 平台限制（硬约束）

| 限制 | 数值 | 影响 |
| --- | --- | --- |
| 主包 / 单个分包 | ≤ 2 MB | towxml、图标必须精简或分包 |
| 所有分包总和 | ≤ 30 MB（服务商代开发 ≤ 20 MB） | 充足 |
| 页面栈 | ≤ 10 层 | 编辑流程用 `redirectTo` |
| 本地缓存 | 单 key ≤ 1 MB，总 ≤ 10 MB | 草稿缓存无压力 |
| 网络 | 必须 HTTPS + ICP 备案域名 | 后端前置条件 |
| web-view | **个人主体不可用** | 套壳出局 |
| 远程 JS 执行 | 禁止 | Tiptap CDN / 动态脚本不可行 |
| 外链字体 | 不支持 | Geist 字体必须换 |
| 小程序备案 | 需选择与功能匹配的类目 | 见 §3 |

---

## 7. 技术路线（基线修正后重估）

| 路线 | 复用度 | 说明 | 推荐 |
| --- | --- | --- | --- |
| **uni-app（Vue 3）** | **35%** | 页面用 Vue 重写，但 `markdown-utils.js` / `structured-markdown.js` / `state.js` / `drafts.js` 可直接 import；一套代码未来可扩到支付宝/抖音小程序 | ✅ **推荐** |
| Taro 4 | 30% | 同样需重写视图层，无额外收益 | ⭕ |
| 原生小程序 | 30% | 逻辑层 import 需改造（原生小程序对 npm 包支持较差） | ⭕ |
| web-view 套壳 | — | **个人主体不可用** | ❌ |

> **注意**：uni-app 的红利主要来自 Vue SFC 复用，而本项目**没有 SFC**，所以收益比 v1 估计的低。**选 uni-app 的真正理由变成"跨端扩展 + 生态成熟（towxml、组件库）"，而不是"能搬现有代码"。**

**工程结构建议**（新建，不动 `cms-frontend`）：

```
veldr/
├─ cms-frontend/        # 保持 Web 端不动
└─ mp/                  # 新增 uni-app 工程
   ├─ src/
   │  ├─ pages/
   │  ├─ lib/           # ← 从 cms-frontend/src 拷贝的纯逻辑
   │  │  ├─ markdown-utils.js
   │  │  ├─ structured-markdown.js
   │  │  ├─ page-content.js
   │  │  └─ state.js
   │  ├─ api/           # ← 重写（uni.request + Bearer）
   │  └─ stores/
   ├─ pages.json
   └─ vite.config.js
```

---

## 8. 分阶段计划

| 阶段 | 范围 | 说明 |
| --- | --- | --- |
| **P0 后端放行** | client 白名单 + CORS origin + **后端 Markdown 净化（新增 `sanitize-html`）** + 确认域名备案/HTTPS | 可先用 Postman 跑通 |
| **P1 只读端** | 登录、笔记列表、详情（towxml 渲染）、分类筛选 | **MVP**，可上架 |
| **P2 写作** | Markdown 编辑器（textarea + 工具栏）+ 保存 + 草稿 | 核心闭环 |
| **P3 图片** | `wx.chooseMedia` + `compressImage` + `uni.uploadFile` | 后端 `/api/cms/upload` 已就绪 |
| **P4 打磨** | 分包、骨架屏、暗色、离线草稿 | — |

**砍掉**：视频库、白板、导出、图片画廊多列、分享。

---

## 9. 风险清单（按严重度排序）

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| **类目不符导致备案/审核被拒** | **最高** | 产品收敛为"仅本人可见的私人备忘录"；名称/简介避免"社区/分享/公开"字样；选「工具」类目 |
| **审核需测试账号，给密码=暴露私人笔记** | 高 | 内置只读演示模式（mock 数据），或准备专用演示账号 |
| web-view 不可用（个人主体） | 高（已确定） | 放弃套壳，真写小程序 |
| Tiptap 编辑器不可用 | 高（已确定） | 改 Markdown textarea 编辑器 |
| DOMPurify 不可用导致 XSS 防线缺失 | 高 | **净化下沉后端**，不得省略 |
| 域名未备案 / 无 HTTPS | 中高 | 立项前先确认 `cms.lifetip.top` 状态 |
| towxml 对自定义块（`:::indent`、toggle）支持不足 | 中 | 用 `structured-markdown.js` 预处理后再渲染；必要时自定义节点 |
| 2 MB 主包超限 | 中 | towxml 与编辑器放分包 |

---

## 10. 一句话结论（公开上架视角）

> **技术上完全可行，但这是一次"逻辑层复用、视图层重写"的移植，不是编译转换。**
>
> **后端改动 ≈5%**（扩 client 白名单 + 放行 origin + **新增 Markdown 净化**）；
> **前端只有 Markdown 逻辑层（约 35%）能搬**，`cms-frontend` 是原生 JS 且视图层 239 处依赖浏览器 API，页面必须重写；
> **真正的门槛不在技术，在合规**：个人主体用不了 web-view，且「笔记」类目个人备案"不建议选择"——必须把产品定义收敛成**"仅本人可见的私人备忘录工具"**、砍掉视频与分享，选「工具」类目才能过审。

---

## 11. 追加场景：仅自己访问（不对外发布）

若小程序的唯一使用者是开发者本人，**合规约束几乎全部消失，但平台技术限制一条不变**。

### 11.1 约束变化对照

| 约束 | 公开上架 | 仅自用（体验版，不提交审核） | 说明 |
| --- | --- | --- | --- |
| 类目（「笔记」个人不建议选） | 🔴 阻塞 | 🟢 **消失** | 不提交审核就不触发类目/备案审核 |
| 域名 ICP 备案 + HTTPS | 🔴 必需 | 🟡 **可绕过** | 体验版开启"开发调试"后**不校验合法域名，甚至可用 IP** |
| 内容安全（`msgSecCheck`） | 🟡 必需 | 🟢 不需要 | 同上 |
| 隐私政策 / 测试账号 | 🟡 必需 | 🟢 不需要 | 同上 |
| 视频库类目限制 | 🔴 阻塞 | 🟡 **可保留功能** | 不上架不审核；但视频播放仍需可取的资源地址 |
| 分享 / 他人可见 | 🔴 必须砍 | 🟢 无所谓 | 自用无传播风险 |
| **web-view（个人主体）** | 🔴 不可用 | 🔴 **仍不可用** | 平台按主体类型限制，与是否自用无关 |
| **无 DOM / 无 iframe** | 🔴 | 🔴 **不变** | Tiptap 仍不可用 |
| **DOMPurify 不可用** | 🔴 | 🔴 **不变** | 净化仍须下沉后端 |
| **包体积 2MB / 页面栈 10** | 🟡 | 🟡 **不变** | 平台硬限制 |
| **239 处浏览器 API 需重写** | 🔴 | 🔴 **不变** | 这是主要工作量，自用也省不掉 |

**结论：自用能省掉的主要是"合规收尾工作"（约 20~30%），核心移植工作量不变。**

### 11.2 自用场景的两条免备案技术路径

**路径 B1：体验版 + 开启调试**

- 微信官方机制：体验版在「小程序助手 → 打开开发调试」后，**不校验 request 合法域名，接口地址可用 IP**
- 可直接指向现有后端（如 `http://<服务器IP>:5000`），无需备案、无需 HTTPS
- 代价：每次使用需确保调试态开启；依赖平台该机制的持续性，非长期保证

**路径 B2：微信云函数做代理（更稳，推荐）**

```
小程序 → wx.cloud.callFunction('veldrProxy', { path, method, body })
            ↓（微信受信通道，无需配置域名）
       云函数（Node，运行在腾讯云）
            ↓（服务端出网，不受小程序域名白名单限制）
       自建后端 http://<服务器>:5000/api/cms/...
```

- 云函数对外请求**不受小程序 request 合法域名限制，也不要求目标域名备案**，甚至可访问 HTTP
- 调用云函数本身通过 appid 关联，**无需配置任何域名**
- 个人主体可开通云开发，免费额度对个人自用绰绰有余
- 额外好处：JWT / 密码不落在小程序端，云函数内可统一注入 `Authorization: Bearer`
- 代价：多一跳网络，延迟略增；需要写一个薄代理云函数（约 50 行）

### 11.3 自用场景下仍然建议做的事

1. **保留瘦身**：白板（`whiteboard.js` 34 处 DOM，需 canvas 重写）投入产出比太低，仍建议砍；视频库若要保留需接受播放地址依赖
2. **保留后端 Markdown 净化**：自用也有多端写入（Web/Flutter/小程序），XSS 防线不能省
3. **登录体验**：自用可做成"一次登录、长期保持"，把 token 存 Storage，避免每次输密码

### 11.4 诚实建议：先问要不要做小程序

如果目标只是"自己随时能看笔记"，**小程序不是性价比最高的选择**：

- 已有 `cms-frontend` Web 端 → 加 `manifest.json` + service worker 做成 PWA，手机浏览器"添加到主屏幕"，全屏、有图标、可离线，**半天工作量，零审核零备案**
- 已有 `mobile/` Flutter App（本地优先 + 同步）→ 本就是移动端的正解

小程序的独特价值只在"**微信内随手打开、不用记网址**"。若这个价值对你不成立，建议走 PWA。

若确定要微信入口，推荐 **路径 B2（体验版 + 云函数代理）**：免备案、免审核、功能可不做取舍，是自用场景下的最优解。

---

## 12. 多用户方案：每个微信账号只能访问自己创作的内容

> 场景：开放给多人使用。**A 的微信账号永远看不到 B 的笔记**，每人拥有独立的笔记/笔记本/标签/图片空间。
>
> 这一条改动把系统从「单人单密码」升级为「多租户」。结论：**技术上限已铺好一半，真正的门槛重新回到个人主体合规。**

### 12.1 先给结论

| 维度 | 判断 |
|---|---|
| 数据库 schema | ✅ **已是多租户结构**（13 张表全带 `owner_id`，`cms_users` 表已存在） |
| 存储层 | ⚠️ **必须切 PostgreSQL**（见 12.3） |
| 鉴权层 | ❌ **必须重写**（见 12.2，当前全项目只有一个身份） |
| 隔离正确性 | ⚠️ 查询已按 `owner_id` 过滤，但**附件/图片目录是共享的**（见 12.4） |
| 个人主体合规 | ❌ **最大风险**（见 12.5） |

### 12.2 决定性发现：当前全站只有一个身份

`backend/middleware/auth.js` 里，JWT 的 `sub` 被硬编码为全局常量：

```js
const signAuthToken = (sessionVersion = 1) => jwt.sign(
  { sub: config.cms.ownerId, sv: Number(sessionVersion) || 1 },   // ← 永远是同一个 ownerId
  ...
);

const authenticateRequest = async (req) => {
  ...
  if (![config.cms.ownerId, 'admin'].includes(payload?.sub)) return null;  // ← 白名单只有 ownerId
  return { ...payload, sub: config.cms.ownerId };                          // ← 强制改写回 ownerId
};
```

也就是说：**哪怕前端传不同的 token，后端也一定会把它改写回同一个 owner。** "多用户"在这个 codebase 里目前是不存在的概念，必须从这一处开始重建。

连带后果：`sessionVersion`（改密码后全局踢下线）目前取的是 `Password` 表单行。多用户后，失效必须是**按用户**的——好消息是 `cms_users` 表里已经有 `session_version` 字段，不用加表结构。

### 12.3 必须裁撤/替换的技术前提

| # | 现状 | 必须改成 | 为什么 |
|---|---|---|---|
| 1 | `CMS_STORE=json`（默认） | **`CMS_STORE=postgres`** | `cmsStore.js`（214 行 JSON 版）**完全没有 owner 概念**，一个都没有。只有 Postgres 版有 `owner_id`。多用户 == 强制上 PG |
| 2 | `config.cms.ownerId` 常量 | 改为 **per-request**：`req.auth.userId` | 见 12.2 |
| 3 | `cms_users` 表无 openid | 新增 `openid varchar(64) UNIQUE`（迁移 003） | 微信身份的唯一锚点 |
| 4 | 单个研发热水 / 下载？<br>`CMS_UPLOAD_DIR` 单目录 | **按 owner 分目录**：`uploads/cms/<ownerId>/` | 当前所有人的图片都在同一目录，URL 可枚举，A 能看到 B 的图 |
| 5 | 无微信登录 | 新增 `POST /api/auth/wechat` | wx.login → code → 后端 code2Session → openid → upsert user → 签发 JWT |
| 6 | viewer / editor 二元角色 | **简化为"自己内容的 owner"** | 多用户下"未登录也能看非 private 笔记"必须删除 |

**关于 UnionID：不要用。** 拿 UnionID 需要小程序绑定微信开放平台且该开放平台账号完成开发者资质认证，个人主体基本拿不到。而这个场景下 **openid 完全够用**——它本身就是"一个用户在这个小程序里的永久唯一标识"，用户删了小程序再回来仍然是同一个 openid。只在"同一用户在公众号/App/小程序之间打通身份"时才需要 UnionID。

### 12.4 后端改造清单（按文件）

改动密度实测：

| 文件 | owner 相关行数 | 说明 |
|---|---|---|
| `modules/cms/cmsV1Routes.js` | 70 | 第 11 行 `const ownerId = () => config.cms.ownerId` 是单点，但 SQL 传参需逐个替成 `req.auth.userId` |
| `modules/cms/cmsPostgresStore.js` | 34 | 每个 CRUD 函数需接受 `ownerId` 参数并往下传（**这里是最大工作量**） |
| `modules/cms/cmsAttachments.js` | 12 | 附件 owner 绑定 + 分目录 |
| `modules/cms/cmsPostgresDb.js` | 1 | 初始化时按 `CMS_OWNER_ID` 灌的第一个用户（保留作历史数据归属） |
| `modules/cms/cmsAccount.js` | 1 | 同上 |
| `middleware/auth.js` | 2 | `signAuthToken` 与 `authenticateRequest`，见 12.2 |

**乐观的一面**：`cms_notes` 已经是 `UNIQUE (owner_id, legacy_id)`，`legacy_id` 走 sequence，`await` 所有读都已 `WHERE owner_id=$1`。也就是说**隔离的 SQL 骨架已经写好了**，改造是"把常量换成变量并逐层透传"，不是重新设计数据模型。

**容易被漏掉的一处**：`cmsAuth.js` 目前是

```js
req.cmsRole = req.auth?.isAuthenticated ? 'editor' : 'viewer';
```

没有任何 resource-level 校验。多用户后正确的做法是**先靠 `WHERE owner_id=$1` 让别人的笔记直接查不到（返回 404 而非 403，避免泄露"这条笔记是否存在"）**，再在写路径上补一次 `assertOwner`。

### 12.5 最大风险：个人主体 + 多人创作 = 踩类目红线

这是本次结论里最需要你先做完决定的部分，因为它可能让后面所有技术工作白做。

微信官方《个人主体开放的服务类目》里，和笔记最接近的类目措辞是 **「工具 > 备忘录」**：

> 备忘录：**待办事项记录功能（不涉及用户原创内容的传播及公开访问）**

再对照平台运营规范的口径：

> 个人开发者**禁止**开发社交社区、论坛留言、私信互动、投稿公示、**用户动态发布等 UGC 互动类功能**……仅可开发纯工具、**无用户自主内容发布**的单机类功能

由此推出一个有点残酷的结论：

> **"每人只看自己的"恰好是能过审的唯一形态**——因为备忘录类目明确排除了"传播及公开访问"。只要内容不外溢，这个产品形态就落在工具类目里；一旦加了"分享给别人看/对外可见/公开的 hash 链接"，立刻滑出类目并被判定为 UGC 社区。

**但仍然有一个未消解的风险**：开放注册后，任意微信用户都可"发布原创内容"这件事本身，审核员有可能直接按 UGC 判。三方开发者的实测反馈里就有"个人主体做了 UGC 功能上线一天被永久封号、且不可解封"的案例。

降低风险的做法（**强烈建议至少做 1 和 2**）：

1. **不要开放注册**——改成邀请码 / 白名单制，把产品定位写成"本人与被邀请者的私人备忘录"，而不是"注册即可用的云笔记"
2. **产品定位彻底收敛到「私人备忘」**：名称、简介、页面上不出现"社区/分享/公开/广场/发现"字样
3. **保留 Web 端自用 + 小程序只做只读/轻量编辑**，进一步弱化"发布"属性
4. **升级主体**：办个体工商户执照（免费、约 7 天）后按企业主体注册，UGC、手机号授权、支付全放开——如果这是要认真长期做多人版本的产品，这是唯一干净的解

即便走 1–3，**也建议先把主体升级这条路记在心上**。

### 12.6 其他必须落实的平台要求（多人版比自用版多出来）

- **《用户隐私保护指引》必须配置**，且指引内容要和实际调用的 API 一一对应；用户同意前隐私接口会被拦截
- `wx.login` 属于 **需要声明的隐私接口** —— 不声明会直接报 `fail api scope is not declared in the privacy agreement`
- **`wx.getPhoneNumber` 不可用**（硬性要求已认证的非个人主体）→ 手机号绑定这条路直接封死，只能用 openid
- **内容安全**：支持 UGC 的小程序要求接入 `security.msgSecCheck`（服务端 + 前端双审）。这条建议配上：在 `cmsRoutes.js` 的 POST/PUT notes 入口做服务端校验
- **ICP 备案 + HTTPS + request 合法域名**：多人版要走正式版，备案逃不掉
- AppSecret **只能存在于后端**，`session_key` 绝不下发给小程序

### 12.7 前端（小程序侧）需要砍的

沿用 §6/§7 的结论，多人版额外要砍/改：

| 模块 | 处置 | 原因 |
|---|---|---|
| viewer 未登录可见 | **砍** | 与"只有自己的内容"直接冲突 |
| hash 分享链接 / 对外导出分享 | **砍** | 备忘录类目明令不得公开访问 |
| 白板（`whiteboard.js`，Canvas） | **MVP 砍** | 小程序 Canvas 事件模型不同，改动最大的收益最低 |
| 视频库 `/api/media` | **砍** | 视频类目个人主体不建议，且不符工具定位 |
| Tiptap 富文本编辑器 | **重写** | ProseMirror 依赖 DOM，小程序无解 → `textarea` + Markdown 工具栏 |
| `markdown-runtime.js` 的 DOMPurify | **下沉到后端** | 小程序跑不了，净化必须服务端做（`cmsRoutes.js` POST/PUT 入口） |
| Font Awesome CDN | **内联** | 不支持外链字体，参考 README 的本地内联方案 |

可直接搬过去的（零 DOM，且都带 vitest）：`markdown-utils.js`、`structured-markdown.js`、`page-content.js`、`state.js`、`drafts.js`、`video-upload.js`。

### 12.8 建议的落地顺序

1. **先做决定**：个人主体 + 邀请码白名单，还是升级个体户主体（这一步不定，后面都可能白做）
2. **PG 迁移**：`CMS_STORE=postgres`，把现有数据全量灌到 `CMS_OWNER_ID` 名下
3. **改 `middleware/auth.js`**：`sub` 参数化 + per-user `sessionVersion`
4. **透传 ownerId**：`cmsV1Routes.js` → `cmsPostgresStore.js` → `cmsAttachments.js`（机械但量大）
5. **附件分目录 + `cmsAuth.js` 资源级校验**
6. **新增 `POST /api/auth/wechat`** + openid 绑定 + 邀请码
7. **服务端 `msgSecCheck`**（多人版建议加）
8. **新建 `mp/` uni-app 工程** 做小程序前端，迁移上述 6 个逻辑模块

第 1 步是 gate，第 4 步是工作量主体。
