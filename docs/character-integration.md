# Project Context Analysis

## Analysis Purpose

2026-10-22：将已验收的小商接入浮岛，替代旧方块向导。角色与建筑共用 WebGL 画布，聊天与来信沿用现有接口。

## Codebase Structure

- `js/emc-island-guide.js`：场景角色加载、导航、行为与遮挡。
- `js/emc-character-motion.js`、`emc-character-face.js`、`emc-character-props.js`：13 个动作、26 个面部形态键、信封与感叹号。
- `assets/models/characters/xiaoshang-animated-v1-{web,lite}.glb`：运行模型；同目录 `.blend` 和未压缩 GLB 为源文件。
- `tools/character-preview.html`：独立验收入口，不是另一份游戏角色。

## Dependencies

依赖仓库固定版 Three.js、GLTFLoader 及同源模型加载器。继承下载重试、取消、贴图解码和超时；角色完成准备后，场景才编译并移除加载遮罩。流畅档使用 lite 模型。

## Connections

`ShopScene.ready` 等待 `IslandGuide.ready`。`onNpcFrame` 将位置与可见性传给聊天浮层。`setTalking` 停步面向相机，`speak` 驱动回复时的文字节奏口型；这不是语音音素同步。`setHoldingLetter` 触发欢跳举信，任务信在约 1.6 秒后从真实手持位置飞入；转移或取消后隐藏道具并完成落地。

## Architecture Patterns

导航根节点使用 +Z 朝前，视觉子节点将原始 +X 朝前模型转到相同基准并缩放为 0.78。遮挡射线仍检查建筑。角色到达外围停靠点后随机停留、换向，看橱窗或眺望；附近有装饰时转向观察。不会播放旧方块动作。

## Codebase Conventions

所有加载与释放跟随场景生命周期。角色材质不进入店铺染色列表；禁止修改脸部拓扑或移除构建源文件。新增临时验收输出放在本机归档目录中。

## Dependency Graph

`emc-shop-app → ShopScene → IslandGuide → model-loader / character-motion / character-face / character-props → Three.js`

## Component Relationships

聊天输入调用 `setTalking`，回复调用 `speak`，结束调用 `stopSpeaking`。任务来信调用 `setHoldingLetter`。`render_game_to_text().npc` 暴露模型、画质、行为、动作、口型与道具状态；`advanceTime(ms)` 可推进角色用于验收。

## Key Insights

旧角色为程序化几何，没有单独的 GLB；旧实现已复制到本机 仓库外的本地归档目录。当前表情源模型仍用于构建，不属于废弃资产。

验证入口：`node js/tests/emc-island-character-browser.cjs`。浏览器测试依赖由 `EMC_PLAYWRIGHT_MODULE` 指定；覆盖高清/流畅、桌面/移动端、对话、遮挡、来信、失败重试。
