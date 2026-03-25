# Cloudflare Workers Edge TTS 架构方案 (方案 A)

本方案旨在采用成熟开源的 Cloudflare Worker 项目，以最快速度为现有的纯前端 Vite 应用引入高保真的微软 Edge 神经网络语音。

## 1. 总体架构

方案采用典型的“前后端分离” Serverless 架构：

```mermaid
graph LR
    A[Vite 前端] -->|HTTP 请求| B(Cloudflare Worker 代理)
    B <-->|WebSocket| C[微软 Edge TTS 接口]
    C -->|返回高质量音频流| B
    B -->|向下透传| A
```

1. **Vite 前端应用**：移除原有的机械语音插件（`cnchar-voice`），改用 `fetch` 直接呼叫本地/云端的 API 获取语音字节流并播放。
2. **Cloudflare Worker 代理**：借助成熟开源代码，绕过浏览器端的 WebSocket 限制，充当安全网关将我们的请求转发给微软的合成接口，并将其包装为 OpenAI 标准化的 `/v1/audio/speech` 格式。

## 2. 优势分析

- **高音质 + 零成本**：白嫖微软极为出色的神经网络中文发音人（如晓晓、云希），同时 Cloudflare 基础版每日 10 万次请求额度对于个人及中小型功能完全免费。
- **最快落地**：无需手动从零编写底层繁琐的并发控制、流式返回和 JWT token 加密换取等逻辑，直接复用 `snakeying/edgetts-cloudflare` 这类经过验证的通用版 Worker。
- **零运维负担**：无需像 Python 方案那样租用 VPS 虚拟机，Cloudflare Serverless 部署一次永不宕机。

## 3. 里程碑实施计划

整个改造可一次性划分为三个节点：

#### 第一阶段：建立代理节点 (后端)
1. 在代码根目录新建一个名为 `worker` 的文件夹，使用 `git clone` 拉取开源代理项目。
2. 使用 Cloudflare 的开发工具 `wrangler` 安装依赖并在本地暴露在 `8787` 端口供本地测试。通过环境配置可选择是否开启 API_KEY 鉴权机制。

#### 第二阶段：应用层适配 (前端)
1. 在 `src/` 中新增一个简单的调用层（如 `tts.js`），用来包装向 `localhost:8787` 或是生产环境的 URL 发送组装好的网络请求协议。
2. 注入针对文字的音频本地缓存，以保证高频重复收听（比如同一个字被点击多次）的秒级响应。

#### 第三阶段：无缝替换原功能
1. 将 `index.html` 中引入且占体积的 `cnchar-voice` 插件包源脚本剔除。
2. 在原核心代码 `main.js` 中，把触发系统语音 `SpeechSynthesis` 的部分删减重构，导向咱们自己的高质量微服务。

## 4. 部署与上线指引

本地联调结束后，直接在 `worker` 目录下执行一行部署指令：`npx wrangler deploy`。

至此，您便会获得一个挂载在 Cloudflare 公网域名下的高速稳定合声 API，将前端代码中的 URL 一替换，无论您把前端发布在什么平台，您的网页都自动获得了顶级的声音质量。
