# ComfyUI Tag Autocomplete

**English** • [简体中文](./README_ZH.md)

Booru style tag autocompletion for **ComfyUI** — directly inside the prompt box of the
CLIP text encoder nodes.

This project is a full port of the well known
[a1111-sd-webui-tagcomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete)
extension by [DominikDoom](https://github.com/DominikDoom). The tag data, search
behaviour, parser set, usage statistics and settings semantics are kept identical;
only the UI glue was rewritten for ComfyUI (LiteGraph nodes, DOM text widgets,
aiohttp routes and the Vue based settings dialog).

<br/>

# 📄 Description

Tag Autocomplete displays autocompletion hints for recognized tags from "image booru"
boards such as Danbooru and e621, which are primarily used for browsing Anime-style
illustrations.

Since most custom Stable Diffusion models were trained using this information (or were
merged with ones that did), using exact tags in prompts can often improve composition and
consistency, even if the model itself has a photorealistic style.

The extension works **inside the CLIP text encoder node itself** — type in the node's
prompt box and the candidate list appears next to your cursor, exactly like the A1111
version. No extra node, no separate window.

> Disclaimer: the bundled tag lists contain NSFW terms. Use them responsibly.

<br/>

# ✨ Features

- 🚀 Instant completion hints while typing
- ⌨️ Full keyboard navigation (↑ ↓ PageUp/Down Home/End Enter Tab Esc, remappable)
- 🌗 Dark & light theme aware, including the tag category colors
- 🛠️ 56 settings, available both in the **ComfyUI settings dialog** and a standalone panel
- 🈶 Translation support for tags, with optional live translation strip under the prompt
- 🖼️ Extra network previews (LoRA / Embedding / Hypernetwork cards)

Tag completion supports:

- 🏷️ **Danbooru & e621 tags** (post counts, aliases, categories)
- ✨ **Wildcards** (`__file__`, nested folders, YAML collections, UMI conditionals)
- 🔗 **Extra networks**: Textual Inversion embeddings, LoRAs, LyCORIS/LoHa, hypernetworks
- 🎵 **Chants** (long prompt presets)
- 🏷️ **Extra file**, one set of customizable extra tags
- 🎨 **Artist tags** via the `@` trigger, plus `$` style variables

<br/>

# 🆕 What is new in the ComfyUI version

These are the parts that did not exist in the A1111 extension:

### 1. Runs inside the node
Every multiline prompt widget of a CLIP text encoder is hooked
(`CLIPTextEncode`, `CLIPTextEncodeSDXL`, `CLIPTextEncodeFlux`, `CLIPTextEncodeSD3`,
`BNK_CLIPTextEncodeAdvanced`, `smZ CLIPTextEncode`, `*Text Encode*`, …).
The candidate list is a floating popup anchored at the caret and follows the canvas zoom.

### 2. Native settings page
All 56 options are registered through `app.ui.settings.addSetting()` and appear in
**Settings → 🏷️ Tag 自动补全**, grouped as:

| Group | Content |
|---|---|
| Data files | tag file, translation file, old 3-column format, extra file, insert order, chant file |
| Activation | enable, target nodes, node list, negative prompts, disable pysssss popup |
| Result display | max results, show all, step length, delay, follow caret, wiki links, previews, sort order |
| Popup appearance | **width, row height, font size, overall scale** (new in this port) |
| Search & translation | search by alias, only show alias, search by translation, live translation |
| Insertion | underscores, escaping, comma/space, artist `@`, wildcard path mode, trigger words |
| Wildcards & models | wildcards/YAML, embeddings (+ insert format), LoRA, LyCORIS, hypernet, styles, weight, separator |
| Usage sorting | enable, function, min count, max age, recommend cap, aliases |

Changes apply immediately and are stored in ComfyUI's own `comfy.settings.json`
(`TagComplete.*` keys). A standalone panel (🏷️ button, bottom right) adds the JSON editors
(hotkeys, colors), the usage statistics table and manual rescans.

### 3. Editable in the right side panel
The ComfyUI right side panel (**Properties / Parameters** tab) shows the selected node's
widgets. The prompt textarea there now:

- has the same autocomplete popup, including Chinese search,
- is **two-way synced** with the textarea on the canvas,
- falls back to an injected “text (Tag 补全)” editor when the panel only shows a read-only preview.

### 4. ComfyUI-native prompt syntax
Insertion now produces what ComfyUI actually understands:

- embeddings → `embedding:name` (switchable to `<embedding:name>` or the bare name)
- LoRAs → `<lora:name:weight>` (works with `comfyui-prompt-extranetworks`,
  `comfyui-prompt-control`, rgthree power prompts, …), weight taken from the model's
  sidecar `.json` or its safetensors metadata
- wildcards → `__file__` (comfyui-dynamicprompts, Impact Pack, Umi AI)

### 5. Library scanning through ComfyUI itself
Extra networks are read with `folder_paths` (`get_filename_list`), so
`extra_model_paths.yaml`, symlinks and junctions are all respected — a 5.7k LoRA
library is listed in ~0.1 s. Wildcard folders are auto-scanned from
`custom_nodes/*/wildcards`, `<ComfyUI>/wildcards` and this package's `wildcards/`.

### 6. Chinese out of the box
The repository ships a ready configuration (`settings.default.json`):

- tag file `danbooru_e621_merged.csv` (221,787 tags)
- translation file `danbooru_e621_merged_CNv4.csv` (231,417 entries)
- search by translation + alias enabled

Type `女孩` → `1girl`, `蓝眼睛` → `blue_eyes`, and candidates show `english[中文]`.
Full-width separators (`，` `、`) are treated as tag separators too.

### 7. Usage database is compatible
`tags/tag_frequency.db` uses the exact same SQLite schema as the A1111 extension, so the
existing file can be copied over and the ✨ frequent-tag sorting keeps working.

### 8. Zero dependencies
Pure Python (standard library + aiohttp which ships with ComfyUI) and plain ES modules.
No `pip install` step, no build step.

<br/>

# 📦 Installation

### ComfyUI Manager / Registry
Search for **Tag Autocomplete** in the ComfyUI Manager (or
[registry.comfy.org](https://registry.comfy.org)), install, then restart ComfyUI and
hard-refresh the browser (<kbd>Ctrl</kbd>+<kbd>F5</kbd>).

### Manual (git)
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Kerrybuck-17/ComfyUI-TagAutocomplete.git
```
Restart ComfyUI afterwards.

### Manual (zip)
Download the repository as zip, extract it into `ComfyUI/custom_nodes/` so that
`__init__.py` sits directly inside `custom_nodes/ComfyUI-TagAutocomplete/`.

The bundled tag data lives in `tags/` (about 37 MB) and is required for normal tag
completion. Without it only wildcards / LoRAs / embeddings would work.

<br/>

# 🎮 Usage

1. Add a **CLIP Text Encode** node and start typing `1gi` or `女孩`:
   - candidates appear at the caret, colored by category, with post counts
   - <kbd>↑</kbd> <kbd>↓</kbd> select, <kbd>Enter</kbd> insert, <kbd>Tab</kbd> insert the first one,
     <kbd>Esc</kbd> close
   - clicking inserts as well, <kbd>Ctrl</kbd> + click resets the usage count of that tag
2. Trigger characters:
   - `<` → embeddings / LoRAs / chants (`<l:`, `<lora:`, `<h:`, `<c:` narrow it down)
   - `__` → wildcard files; after choosing one, press <kbd>Tab</kbd> again to list its contents
   - `@` → artist tags (enable in settings)
   - `$` → style variables (enable in settings)
3. Settings: **gear icon → 🏷️ Tag 自动补全** (or the 🏷️ button in the bottom right corner).

<br/>

# ❇️ Additional completion support

## Wildcards
Completion triggers on `__` (double underscore). It lists the wildcard files found in
`custom_nodes/*/wildcards`, `<ComfyUI>/wildcards` and `ComfyUI-TagAutocomplete/wildcards/`,
and after choosing a file the replacement lines inside it. Use <kbd>Tab</kbd> for partial
path completion (to the next folder level / to the first difference / always fully).

YAML wildcard collections (`*.yaml` / `*.yml`, dynamic-prompts format) and
[Umi AI](https://github.com/Klokinator/Umi-Format) `Tags:` lists are supported as well.

## Extra networks (Embeddings, Hypernets, LoRA, …)
Typing `<` lists embeddings (`<e:`), LoRAs (`<l:` / `<lora:`) and hypernetworks (`<h:`).
Hover a result to see its preview image if one exists next to the model file.

LoRA / LyCORIS trigger words can be inserted automatically
(`modelKeywordCompletion`): they are read from a sidecar `.json`
(`"activation text"`), from the safetensors metadata (`modelspec.trigger_phrase`,
`ss_activation_text`) or from model-keyword style `lora-keyword.txt` lists.

## Chants
Longer presets or complete prompts, loaded from `tags/*.json`
(`demo-chants.json`, `noob_characters-chants.json` are bundled).
Trigger: `<c:`.

<br/>

# 🌏 Translations

Put a CSV in `tags/` named `<English tag/alias>,<Translation>` (2 columns) and select it as
**Translation file**. Older 3-column files need **“translation file uses old 3-column
format”**.

With a translation file selected:

- searching by the translated word works (`蓝眼睛` → `blue_eyes`)
- candidates show `english[translation]`
- optional live translation strip under the prompt (`liveTranslation`)

Bundled: `danbooru_e621_merged_CNv4.csv` (231k entries) and `danbooru_zh_CN_SFW.csv`.
More community translations:
[a1111-sd-webui-tagcomplete#list-of-translations](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete#list-of-translations).

<br/>

# 🗂 CSV tag data

No header row. Format:

```csv
1girl,0,4114588,"1girls,sole_female"
solo,0,3426446,"female_solo,solo_female"
highres,5,3008413,"high_res,high_resolution,hires"
long_hair,0,2898315,longhair
```

Columns: `tag, category, post count, "aliases"` — count and aliases are optional,
multiple aliases are comma separated inside the quoted field.

Danbooru categories: `0` general, `1` artist, `3` copyright, `4` character, `5` meta.

e621 categories: `-1` invalid, `0` general, `1` artist, `3` copyright, `4` character,
`5` species, `6` invalid, `7` meta, `8` lore.

The category numbers are used for the result colors, configurable with the JSON color map
in the standalone panel.

<br/>

# ⚙️ ComfyUI specifics

- **Where it listens**: widgets whose `element` is a `<textarea>`; the node filter defaults
  to CLIP text encoders and can be switched to *all multiline text boxes* or a custom node list.
- **How values are written**: the widget value is set through `widget.value` and an `input`
  event is dispatched on the textarea, so the workflow is marked dirty and saved correctly.
- **pysssss Autocompleter**: both extensions hook the same text boxes. The port disables the
  pysssss popup by default (option `disableConflictingAutocomplete`) to avoid two lists.
- **No restart needed for settings**, but new Python files require a ComfyUI restart.
- **Browser cache**: after an update use <kbd>Ctrl</kbd>+<kbd>F5</kbd>.

<br/>

# ❓ Troubleshooting

| Symptom | Fix |
|---|---|
| No popup at all | check the node type is a CLIP text encoder; open the browser console and look for `[TagComplete] ready - N tags`; hard-refresh the page |
| Empty tag list | the selected **tag file** must exist in `tags/` |
| Chinese input finds nothing | enable **search by translation** and select a Chinese translation file |
| No wildcards / LoRAs | press **重新扫描通配符 / 模型** in the settings panel |
| Two popups | enable **disable pysssss Autocompleter** |

<br/>

# 🙏 Credits

- Original extension, tag data and algorithms:
  [DominikDoom/a1111-sd-webui-tagcomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete) (MIT)
- ComfyUI port: this repository
- Tag data sources: [Danbooru](https://danbooru.donmai.us/), [e621](https://e621.net/),
  [derpibooru](https://derpibooru.org/); Chinese translations from the community
  (DraconicDragon/dbr-e621-lists-archive and contributors)

<br/>

# 📜 License

MIT — see [LICENSE](./LICENSE). The original copyright notice is preserved.
