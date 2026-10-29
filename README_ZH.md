# ComfyUI Tag Autocomplete

[English](./README.md) • **简体中文**

把 [a1111-sd-webui-tagcomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete)
（作者 [DominikDoom](https://github.com/DominikDoom)）的全套功能移植到 ComfyUI：直接在
**CLIP 文本编码节点的提示词输入框**里提供 Danbooru / e621 / 自定义 CSV 标签补全，
包含别名、翻译、通配符、Embedding、LoRA、LyCORIS、Chant、画师标签、UMI 条件语法、
使用频率排序、预览图等。

标签库、搜索算法、解析器、使用统计、设置语义都与原插件保持一致；只把 A1111 专用部分
（Gradio DOM、A1111 设置页、extra networks、`updateInput()`）换成 ComfyUI 的等价实现
（LiteGraph 节点、DOM 文本控件、aiohttp 路由、`widget.value` 写回）。

> 注意：内置标签库包含 NSFW 词条，请自行判断使用场景。

---

## ✨ 功能

- 🚀 输入即出补全提示（默认 100ms 防抖）
- ⌨️ 完整键盘导航（↑↓ PageUp/Down Home/End Enter Tab Esc，可自定义 keymap）
- 🌗 跟随深浅主题，含标签分类颜色
- 🛠️ **56 项设置**，既在 **ComfyUI 设置对话框**里，也有独立面板
- 🈶 标签翻译，可选提示词下方实时翻译条
- 🖼️ LoRA / Embedding / Hypernet 预览图

补全类型：Danbooru & e621 标签（帖子数、别名、分类）、通配符（`__文件__`、嵌套目录、
YAML、UMI）、Embedding、LoRA、LyCORIS/LoHa、Hypernetwork、Chant 长预设、extra 自定义
标签集、`@` 画师标签、`$` Style 变量。

---

## 🆕 ComfyUI 版本新增的内容

这些是原 A1111 插件里没有的部分：

### 1. 直接在节点里补全
自动挂载到所有 CLIP 文本编码节点的多行输入框（`CLIPTextEncode`、`CLIPTextEncodeSDXL`、
`CLIPTextEncodeFlux`、`CLIPTextEncodeSD3`、`BNK_CLIPTextEncodeAdvanced`、
`smZ CLIPTextEncode`、`*Text Encode*` 等）。候选列表浮在光标位置，并跟随画布缩放。

### 2. 原生设置页
56 个选项通过 `app.ui.settings.addSetting()` 注册到 **设置 → 🏷️ Tag 自动补全**：

| 分组 | 内容 |
|---|---|
| 数据文件 | 主标签文件、翻译文件、旧三列格式、额外标签文件、插入位置、Chant 文件 |
| 启用范围 | 总开关、生效节点、节点列表、负面提示词、禁用 pysssss 弹窗 |
| 结果显示 | 最大结果数、显示全部、每次加载数、触发延迟、跟随光标、wiki 链接、预览图、排序 |
| **补全窗口外观** | **窗口宽度、每格高度、字体大小、整体缩放比例**（本移植版新增） |
| 搜索与翻译 | 搜索别名、只显示别名、按翻译搜索、实时翻译 |
| 插入 | 下划线转空格+排除表、括号转义、逗号/空格/末尾空格、@ 画师、通配符补全模式、触发词 |
| 通配符与模型 | 通配符/YAML、Embedding（含插入格式）、LoRA、LyCORIS、Hypernet、Style、权重、分隔符 |
| 使用频率排序 | 开关、排序函数、最小次数、最大天数、推荐上限、别名计入 |

改动即时生效，保存在 ComfyUI 自己的 `comfy.settings.json`（`TagComplete.*`）。
右下角 **🏷️** 按钮打开独立面板，额外提供 JSON 编辑（快捷键/颜色）、使用统计表和手动重扫。

### 3. 右侧「属性 / 参数」面板可编辑
选中 CLIP 节点后，右侧面板里的 `text` 输入框同样带补全，并且和画布上的输入框
**双向同步**；若面板只显示只读预览，会自动补一个可编辑的「text（Tag 补全）」文本框。

### 4. ComfyUI 原生提示词语法
- Embedding 插入为 `embedding:名字`（可切换 `<embedding:名字>` 或裸名）
- LoRA 插入为 `<lora:名字:权重>`（配合 `comfyui-prompt-extranetworks`、
  `comfyui-prompt-control`、rgthree 等），权重优先读 sidecar `.json` 或 safetensors 元数据
- 通配符保持 `__文件__`（comfyui-dynamicprompts / Impact Pack / Umi AI）

### 5. 用 ComfyUI 自己的目录索引扫描模型
通过 `folder_paths.get_filename_list()` 读取，`extra_model_paths.yaml`、符号链接和
junction 都能识别；5700+ 个 LoRA 约 0.1 秒列完。通配符自动扫描
`custom_nodes/*/wildcards`、`<ComfyUI>/wildcards` 和本包的 `wildcards/`。

### 6. 开箱即用的中文
仓库自带一份默认配置（`settings.default.json`）：

- 标签库 `danbooru_e621_merged.csv`（221,787 条）
- 翻译库 `danbooru_e621_merged_CNv4.csv`（231,417 条）
- 「按翻译搜索」「搜索别名」开启

输入 `女孩` → `1girl`，`蓝眼睛` → `blue_eyes`，候选显示 `英文[中文]`；中文逗号 `，`、
顿号 `、` 也会被当作分隔符。

### 7. 使用统计库与原插件通用
`tags/tag_frequency.db` 表结构完全一致，把 A1111 的旧库复制过来即可延续 ✨ 常用标签排序。

### 8. 零依赖
纯 Python 标准库 + ComfyUI 自带的 aiohttp，前端是原生 ES Module，无需 pip 安装或构建。

---

## 📦 安装

### ComfyUI Manager / Registry
在 ComfyUI Manager 里搜索 **Tag Autocomplete**（或到
[registry.comfy.org](https://registry.comfy.org)），安装后重启 ComfyUI，并在浏览器
<kbd>Ctrl</kbd>+<kbd>F5</kbd> 强刷一次。

### 手动 git
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Kerrybuck-17/ComfyUI-TagAutocomplete.git
```

### 手动 zip
下载仓库 zip，解压到 `ComfyUI/custom_nodes/`，保证
`__init__.py` 直接位于 `custom_nodes/ComfyUI-TagAutocomplete/` 下。

`tags/` 内自带约 37MB 标签数据，是普通标签补全所必需的；没有它只有通配符 / LoRA /
Embedding 补全可用。

---

## 🎮 使用

1. 新建 **CLIP Text Encode** 节点，在文本框输入 `1gi` 或 `女孩`：
   - 候选按分类着色、带帖子数，中文显示为 `英文[中文]`
   - `↑` `↓` 选择，`Enter` 插入，`Tab` 插入第一个，`Esc` 关闭
   - 鼠标点击同样可插入；`Ctrl + 点击` 清除该标签的使用计数
2. 触发符：
   - `<` → Embedding / LoRA / Chant 列表（`<l:`、`<lora:`、`<h:`、`<c:` 可缩小范围）
   - `__` → 通配符文件；选中后再按 `Tab` 会列出文件内容
   - `@` → 画师标签（需开启）
   - `$` → Style 变量（需开启）
3. 设置：**齿轮 → 🏷️ Tag 自动补全**，或右下角 **🏷️** 按钮。

---

## 📁 目录结构

```
ComfyUI-TagAutocomplete/
├─ __init__.py              # WEB_DIRECTORY + 路由注册
├─ tc_common.py             # 路径 / 设置存储（默认配置三层合并）
├─ tc_data.py               # 标签库扫描、通配符、模型列表、预览、使用频率数据库
├─ tc_routes.py             # /tagcomplete/* 的 aiohttp 接口
├─ settings.default.json    # 仓库自带默认配置（中文、合并集、窗口外观）
├─ tags/                    # 标签 CSV + 翻译 + Chant
├─ wildcards/               # 自己的通配符目录（.txt / .yaml）
└─ web/                     # 前端（自动作为 ES Module 加载）
   ├─ tagcomplete.js        # 入口：注册扩展、加载数据、挂载到节点
   ├─ tc_attach.js          # 找到 CLIP 节点的文本框并绑定
   ├─ tc_engine.js          # 搜索 / 解析器 / 弹窗 / 键盘 / 插入
   ├─ tc_config.js          # 默认配置 + 运行时状态
   ├─ tc_data.js            # 标签文件加载
   ├─ tc_schema.js          # 全部选项定义（两套 UI 共用）
   ├─ tc_native_settings.js # 注册到 ComfyUI 设置对话框
   ├─ tc_settings.js        # 独立面板（JSON / 统计 / 重新扫描）
   ├─ tc_panel.js           # 右侧「属性/参数」面板里的提示词编辑
   ├─ tc_style.js           # 样式、主题与弹窗尺寸
   └─ tc_util.js            # CSV 解析、光标定位等
```

---

## 🗂 功能对照

| 功能 | A1111 插件 | 本移植版 |
|---|---|---|
| 标签补全（前缀/边界匹配、`*` 通配前缀） | ✅ | ✅ 相同算法 |
| 分类着色（danbooru / e621 / derpibooru / merged） | ✅ | ✅ 跟随深浅主题 |
| 别名搜索 / 只显示别名 / `别名 ➝ 实际` | ✅ | ✅ |
| 翻译文件（2 列 / 旧 3 列）、按翻译搜索、`[中文]` 显示 | ✅ | ✅ |
| 提示词下方实时翻译 | ✅ | ✅ 浮层显示，点击可定位 |
| extra 自定义标签文件（插入到前/后） | ✅ | ✅ |
| 通配符 `__文件__`、嵌套路径三种补全模式 | ✅ | ✅ |
| YAML 通配符（dynamic-prompts / UMI） | ✅ | ✅ |
| Embedding `<` | ✅ A1111 写法 | ✅ 默认写 `embedding:名字`（可切换） |
| LoRA `<lora:` | ✅ | ✅ `<lora:名字:权重>`，权重读 sidecar/元数据 |
| LyCORIS、Hypernetwork、Chant | ✅ | ✅ |
| 画师标签 `@`、UMI 条件语法、Style 变量 | ✅ | ✅ |
| 使用频率记录 + 排序（3 种函数、最小次数、最大天数、推荐上限、别名计入） | ✅ | ✅ 同一套 sqlite 表结构 |
| ✨ 常用标记、Ctrl+点击清计数、🔁 已使用标记 | ✅ | ✅ |
| 帖子数紧凑显示、wiki 跳转、预览图 | ✅ | ✅ |
| 键盘导航、插入规则（下划线/括号/逗号/空格）、LoRA 触发词 | ✅ | ✅ |
| 白/黑名单模型过滤 | ✅ | ✅ 改为「按节点类型/节点列表启用」 |
| 设置面板 | A1111 设置页 | ✅ ComfyUI 设置 → 🏷️ Tag 自动补全（56 项 / 8 组）+ 独立面板 |
| 属性面板编辑 | — | ✅ 右侧「参数」页可编辑并双向同步 |
| 补全窗口尺寸 | — | ✅ 宽度 / 每格高度 / 字体 / 缩放 |

---

## 🌏 翻译

翻译文件放在 `tags/`，格式为 `<英文标签/别名>,<翻译>`（2 列），在设置里选中
**翻译文件** 即可。旧的三列格式需打开「翻译文件使用旧版三列格式」。

选中后：可用中文搜标签、候选显示 `英文[中文]`、可选实时翻译条。
内置 `danbooru_e621_merged_CNv4.csv`（23 万条）与 `danbooru_zh_CN_SFW.csv`。
更多社区翻译见
[原项目列表](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete#list-of-translations)。

---

## 🗂 CSV 标签格式

无表头，格式：

```csv
1girl,0,4114588,"1girls,sole_female"
solo,0,3426446,"female_solo,solo_female"
highres,5,3008413,"high_res,high_resolution,hires"
long_hair,0,2898315,longhair
```

列：`标签, 分类, 帖子数, "别名"`，帖子数与别名可省略，多别名用逗号分隔并整体加引号。

Danbooru 分类：`0` general、`1` artist、`3` copyright、`4` character、`5` meta。
e621 分类：`-1` invalid、`0` general、`1` artist、`3` copyright、`4` character、
`5` species、`6` invalid、`7` meta、`8` lore。

分类号用于候选颜色，可在独立面板的 JSON 颜色表里改。

---

## ⚙️ ComfyUI 相关细节

- **监听范围**：`element` 为 `<textarea>` 的控件；节点过滤默认 CLIP 文本编码，
  可改「所有多行文本框」或自定义节点列表。
- **写回方式**：设置 `widget.value` 并派发 `input` 事件，工作流会被正确标记为已修改并保存。
- **pysssss Autocompleter**：两者都会挂到同一个输入框，默认禁用对方的弹窗避免双列表。
- **设置无需重启**，但新增 Python 文件需要重启 ComfyUI。
- **更新后**记得 <kbd>Ctrl</kbd>+<kbd>F5</kbd>。

---

## 🔧 接口（供二次开发）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tagcomplete/info` | 标签文件列表、目录、数据库状态 |
| GET | `/tagcomplete/data` | 通配符 / YAML / UMI / Embedding / LoRA / LyCORIS / Hypernet / Style 列表 |
| POST | `/tagcomplete/refresh` | 重新扫描并返回最新列表 |
| GET/POST | `/tagcomplete/settings` | 读写设置 JSON |
| GET | `/tagcomplete/file?name=` | 读取 `tags/` 下的 CSV / JSON（防目录穿越） |
| GET | `/tagcomplete/wildcard?base=&file=` | 读取通配符文件内容 |
| GET | `/tagcomplete/model-info?kind=&name=` | 触发词 / 偏好权重 |
| GET | `/tagcomplete/model-keywords?kind=&name=` | LoRA 触发词 |
| GET | `/tagcomplete/preview?kind=&name=` | 预览图 |
| POST | `/tagcomplete/frequency/{counts,increase,reset}` | 使用频率读写 |
| GET | `/tagcomplete/frequency/all` | 全部统计（设置页表格） |

---

## ❓ 排查

- **没有弹窗**：确认节点是 CLIP 文本编码；控制台看 `[TagComplete] ready - N tags` 与
  `registered N settings`。没有则说明前端没加载：检查 `web/` 目录、强刷浏览器。
- **标签列表为空**：设置里的「主标签文件」是否存在于 `tags/`。
- **中文搜不到**：确认「按翻译搜索」开启、翻译文件选中了中文库。
- **通配符/模型列表为空**：点「重新扫描通配符 / 模型」。
- **两个弹窗**：勾选「禁用 pysssss Autocompleter 弹窗」。
- **属性面板编辑不了**：确认右侧面板停在「参数」页；插件每 0.5s 同步，必要时会补编辑器。
- **弹窗太小/太大**：设置 → 补全窗口外观。

---

## 🙏 致谢

- 原始插件、标签数据与算法：
  [DominikDoom/a1111-sd-webui-tagcomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete)（MIT）
- 标签来源：[Danbooru](https://danbooru.donmai.us/)、[e621](https://e621.net/)、
  [derpibooru](https://derpibooru.org/)；中文翻译来自社区
  （DraconicDragon/dbr-e621-lists-archive 及贡献者）

## 📜 许可

MIT，见 [LICENSE](./LICENSE)，保留原始版权声明。
