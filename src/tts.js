/**
 * 微软 Edge TTS 前端调用模块 (基于 Cloudflare Worker 代理方案 A)
 * 使用 OpenAI-compatible 接口格式
 */

// ⚠️ 注意：本地测试时可以通过 `npm run dev` 在 worker 目录启动并获得 localhost:8787 的地址
// 部署到 Cloudflare 后，将此处修改为您的外网 URL，例如 https://edgetts-cloudflare.<your-subdomain>.workers.dev
const TTS_API_BASE = 'http://localhost:8787';

// 缓存音频文件以加快反复播放的速度
const audioCache = new Map();
let currentAudio = null;

// 您最喜欢的微软中文音色名称（比如：zh-CN-XiaoxiaoNeural, zh-CN-YunxiNeural 等）
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

/**
 * 停止当前播放的语音
 */
export function cancelSpeech() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    
    // 如果是内存中的 Blob，可以释放
    if (currentAudio.src.startsWith('blob:')) {
      URL.revokeObjectURL(currentAudio.src);
    }
    currentAudio = null;
  }
}

/**
 * 调用远程 Cloudflare Worker API 合成语音并播放
 * @param {string} text 要合成的文本
 * @param {string} voice 微软内置音色
 */
export async function speak(text, voice = DEFAULT_VOICE) {
  if (!text) return;
  
  // 停止之前正在播放的内容
  cancelSpeech();

  const cacheKey = `${voice}:${text}`;

  try {
    let audioBlob = audioCache.get(cacheKey);

    // 没有缓存，发起网络请求合成
    if (!audioBlob) {
      const response = await fetch(`${TTS_API_BASE}/v1/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 如果您的 worker 被设置了鉴权，请加上 Authorization: Bearer <your-key>
        },
        body: JSON.stringify({
          model: 'tts-1',    // 兼容 OpenAI API 格式 
          input: text,       // 文本内容
          voice: voice,      // Edge TTS 特定音色名称
        })
      });

      if (!response.ok) {
        throw new Error(`TTS 请求失败: HTTP ${response.status}`);
      }

      audioBlob = await response.blob();
      audioCache.set(cacheKey, audioBlob); // 保存缓存
    }

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl); // 清理内存
        currentAudio = null;
        resolve();
      };
      
      audio.onerror = (e) => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        reject(e);
      };
      
      audio.play().catch(reject);
    });

  } catch (error) {
    console.error('Edge TTS 播放异常，降级到系统自带 TTS:', error);
    fallbackSpeak(text);
  }
}

/**
 * 降级方案：使用浏览器本身粗糙但免费的合成声音
 */
function fallbackSpeak(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.75; // 原 cnchar 有降速处理
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
}
