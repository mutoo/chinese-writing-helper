import './styles.css';
import { speak, cancelSpeech } from './tts.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="app-shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Xi's Chinese Writing Helper</p>
        <h1>曦仔汉字书写助手</h1>
        <p class="hero-copy">输入一句话，拆成单字，点拼音朗读，再按笔顺一笔一笔练习书写。</p>
      </div>
      <div class="hero-card">
        <span class="hero-label">今日练习</span>
        <strong id="heroSentence">你好，曦仔</strong>
        <span id="heroMeta">准备开始</span>
      </div>
    </header>

    <main class="layout">
      <section class="panel input-panel">
        <label class="panel-title" for="sentenceInput">练习句子</label>
        <div class="input-row">
          <textarea id="sentenceInput" rows="3" placeholder="例如：今天我们一起学习写汉字。">你好，曦仔</textarea>
        </div>
        <div class="action-row">
          <button id="listenButton" class="secondary">语音输入</button>
          <button id="analyzeButton" class="primary">拆成单字</button>
          <select id="voiceSelect" class="secondary" style="margin-left: 8px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--surface-color); color: var(--text-base);">
            <option value="zh-CN-XiaoxiaoNeural">晓晓 (女声/推荐)</option>
            <option value="zh-CN-YunxiNeural">云希 (阳光男声)</option>
            <option value="zh-CN-YunjianNeural">云健 (体育男声)</option>
            <option value="zh-CN-YunxiaNeural">云夏 (可爱男童)</option>
            <option value="zh-CN-XiaoyiNeural">晓伊 (活泼女声)</option>
          </select>
        </div>
        <p id="statusText" class="status-text">支持系统语音输入；如果浏览器允许，也可以直接点“语音输入”。</p>
      </section>

      <section class="panel sentence-panel">
        <div class="panel-head">
          <h2>句子拆解</h2>
          <span id="charCountBadge" class="badge">0 个字</span>
        </div>
        <div id="characterList" class="character-list" aria-live="polite"></div>
        <div class="sentence-actions">
          <button id="playSentenceButton" class="accent">连续播放整句话</button>
        </div>
      </section>

      <section class="panel viewer-panel">
        <div class="viewer-head">
          <div>
            <p id="currentPinyin" class="current-pinyin">-</p>
            <h2 id="currentCharacter" class="current-character">好</h2>
          </div>
          <div class="meta-card">
            <span>第 <strong id="currentIndex">1</strong> / <strong id="totalCount">1</strong> 个字</span>
            <span>笔画数 <strong id="strokeCount">-</strong></span>
          </div>
        </div>

        <div id="writerSurface" class="writer-surface">
          <div id="writer" class="writer-box" aria-label="汉字笔顺动画区域"></div>
          <p class="swipe-hint">左右划动切换上一个或下一个字</p>
        </div>

        <div class="viewer-actions">
          <button id="prevCharacterButton" class="secondary">上一个字</button>
          <button id="nextStrokeButton" class="secondary">下一笔</button>
          <button id="playCharacterButton" class="primary">播放当前字</button>
          <button id="speakCharacterButton" class="secondary">朗读当前字</button>
          <button id="nextCharacterButton" class="secondary">下一个字</button>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <p>
        GitHub:
        <a href="https://github.com/mutoo/chinese-writing-helper" target="_blank" rel="noreferrer">
          mutoo/chinese-writing-helper
        </a>
      </p>
      <p>
        Support:
        <a href="https://buymeacoffee.com/mutoo" target="_blank" rel="noreferrer">
          buymeacoffee.com/mutoo
        </a>
      </p>
      <p>
        Credits:
        本项目的拼音、笔画、笔顺动画与语音能力基于
        <a href="https://theajack.github.io/cnchar/" target="_blank" rel="noreferrer">
          cnchar
        </a>
        及其插件实现。
      </p>
    </footer>
  </div>
`;

const state = {
  sentence: '',
  characters: [],
  currentIndex: 0,
  writer: null,
  sentencePlayback: false,
  recognition: null,
  isListening: false,
  recognitionStartTimer: null,
  recognitionStartedAt: 0,
  recognitionHadResult: false,
  playbackRunId: 0,
  swipeStartX: null,
};

const SENTENCE_CHARACTER_PAUSE_MS = 700;
const SPEECH_RATE = 0.75;
const CHARACTER_NAME_LEAD_MS = 450;
const STROKE_STEP_MS = 900;
const WRITER_READY_RETRY_MS = 120;
const WRITER_READY_MAX_RETRIES = 25;

const elements = {
  sentenceInput: document.querySelector('#sentenceInput'),
  analyzeButton: document.querySelector('#analyzeButton'),
  listenButton: document.querySelector('#listenButton'),
  voiceSelect: document.querySelector('#voiceSelect'),
  playSentenceButton: document.querySelector('#playSentenceButton'),
  prevCharacterButton: document.querySelector('#prevCharacterButton'),
  nextCharacterButton: document.querySelector('#nextCharacterButton'),
  nextStrokeButton: document.querySelector('#nextStrokeButton'),
  playCharacterButton: document.querySelector('#playCharacterButton'),
  speakCharacterButton: document.querySelector('#speakCharacterButton'),
  characterList: document.querySelector('#characterList'),
  statusText: document.querySelector('#statusText'),
  currentPinyin: document.querySelector('#currentPinyin'),
  currentCharacter: document.querySelector('#currentCharacter'),
  currentIndex: document.querySelector('#currentIndex'),
  totalCount: document.querySelector('#totalCount'),
  strokeCount: document.querySelector('#strokeCount'),
  charCountBadge: document.querySelector('#charCountBadge'),
  writer: document.querySelector('#writer'),
  writerSurface: document.querySelector('#writerSurface'),
  heroSentence: document.querySelector('#heroSentence'),
  heroMeta: document.querySelector('#heroMeta'),
};

function getChineseCharacters(text) {
  return Array.from(text).filter((char) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(char));
}

function getPinyin(char) {
  if (!window.cnchar) return '-';
  const [result] = window.cnchar.spell(char, 'tone', 'array');
  return (result || '-').toLowerCase();
}

function getStrokeCount(char) {
  if (!window.cnchar) return '-';
  const [count] = window.cnchar.stroke(char, 'array');
  return count || '-';
}

function getStrokeNames(char) {
  if (!window.cnchar) return [];
  const [names] = window.cnchar.stroke(char, 'order', 'name');
  return Array.isArray(names) ? names : [];
}

function pickStrokeNameVariant(name) {
  if (!name) return '';
  const variants = String(name)
    .split(/[\/／\|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!variants.length) return String(name);
  return variants[Math.floor(Math.random() * variants.length)];
}

function speakText(text) {
  if (!text) return;
  // Get voice from selector, fallback to undefined so tts.js uses its default
  const voice = elements.voiceSelect ? elements.voiceSelect.value : undefined;
  speak(text, voice);
}

function updateStatus(message) {
  elements.statusText.textContent = message;
}

function updateListenButton() {
  elements.listenButton.textContent = state.isListening ? '停止语音输入' : '语音输入';
  elements.listenButton.className = state.isListening ? 'accent' : 'secondary';
}

function clearRecognitionStartTimer() {
  if (!state.recognitionStartTimer) return;
  window.clearTimeout(state.recognitionStartTimer);
  state.recognitionStartTimer = null;
}

function setButtonsDisabled(disabled) {
  elements.prevCharacterButton.disabled = disabled;
  elements.nextCharacterButton.disabled = disabled;
  elements.nextStrokeButton.disabled = disabled;
  elements.playCharacterButton.disabled = disabled;
  elements.playSentenceButton.disabled = disabled;
  elements.speakCharacterButton.disabled = disabled;
}

function stopSentencePlayback() {
  state.sentencePlayback = false;
  state.playbackRunId += 1;
  elements.playSentenceButton.textContent = '连续播放整句话';
}

function renderCharacterList() {
  elements.characterList.innerHTML = '';

  state.characters.forEach((item, index) => {
    const chip = document.createElement('div');
    chip.className = `character-chip${index === state.currentIndex ? ' active' : ''}`;

    const pinyinButton = document.createElement('button');
    pinyinButton.className = 'pinyin-button';
    pinyinButton.type = 'button';
    pinyinButton.textContent = item.pinyin;
    pinyinButton.addEventListener('click', (event) => {
      event.stopPropagation();
      speakText(item.char);
    });

    const charButton = document.createElement('button');
    charButton.className = 'char-button';
    charButton.type = 'button';
    charButton.textContent = item.char;
    charButton.addEventListener('click', () => {
      stopSentencePlayback();
      setCurrentIndex(index, { autoSpeak: true });
    });

    chip.appendChild(pinyinButton);
    chip.appendChild(charButton);
    elements.characterList.appendChild(chip);
  });
}

function clearWriter() {
  elements.writer.innerHTML = '';
  state.writer = null;
}

function createWriter(currentChar, mode = 'step', animateComplete) {
  clearWriter();

  state.writer = window.cnchar.draw(currentChar, {
    el: elements.writer,
    type: window.cnchar.draw.TYPE.ANIMATION,
    clear: true,
    style: {
      radicalColor: '#d85a3f',
      strokeColor: '#1f1a17',
      outlineColor: '#d2c4b2',
      showOutline: true,
      showCharacter: false,
      length: 480,
      padding: 0,
    },
    line: {
      border: true,
      borderColor: '#d9c6b3',
      lineColor: '#c8b19a',
      lineDash: true,
    },
    animation: {
      autoAnimate: false,
      loopAnimate: false,
      stepByStep: mode === 'step',
      strokeAnimationSpeed: mode === 'step' ? 1.1 : 1,
      delayBetweenStrokes: 160,
      animateComplete,
    },
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isWriterMounted(writer) {
  return Boolean(writer && Array.isArray(writer.writers) && writer.writers.length > 0);
}

async function waitForWriterReady(runId, writer, retryCount = WRITER_READY_MAX_RETRIES) {
  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    if (runId !== state.playbackRunId) return false;
    if (writer !== state.writer) return false;
    if (isWriterMounted(writer)) return true;
    await wait(WRITER_READY_RETRY_MS);
  }
  return false;
}

async function drawNextStrokeSafely(runId, writer) {
  for (let attempt = 0; attempt < WRITER_READY_MAX_RETRIES; attempt += 1) {
    if (runId !== state.playbackRunId) return false;
    if (writer !== state.writer) return false;

    try {
      const advanced = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        const started = writer.drawNextStroke(() => {
          finish(true);
        });

        if (!started) {
          finish(false);
        }
      });

      if (advanced) {
        return true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const looksLikeStrokeDataNotReady =
        error instanceof TypeError && message.includes('strokes');

      if (!looksLikeStrokeDataNotReady) {
        throw error;
      }

    }

    await wait(WRITER_READY_RETRY_MS);
  }

  return false;
}

function renderCurrentCharacter() {
  if (!state.characters.length || !window.cnchar || !window.cnchar.draw) {
    clearWriter();
    return;
  }

  const current = state.characters[state.currentIndex];
  current.manualStrokeIndex = 0;
  elements.currentCharacter.textContent = current.char;
  elements.currentPinyin.textContent = current.pinyin;
  elements.currentIndex.textContent = String(state.currentIndex + 1);
  elements.totalCount.textContent = String(state.characters.length);
  elements.strokeCount.textContent = String(current.strokeCount);

  renderCharacterList();
  createWriter(current.char, 'step');
}

function setCurrentIndex(index, options = {}) {
  if (index < 0 || index >= state.characters.length) return;
  state.currentIndex = index;
  renderCurrentCharacter();
  if (options.autoSpeak) {
    speakText(state.characters[state.currentIndex].char);
  }
}

function moveCharacter(delta) {
  if (!state.characters.length) return;
  stopSentencePlayback();
  const nextIndex = Math.max(0, Math.min(state.currentIndex + delta, state.characters.length - 1));
  if (nextIndex === state.currentIndex) return;
  setCurrentIndex(nextIndex, { autoSpeak: true });
}

async function playCharacterStrokeByStroke(index, options = {}) {
  const current = state.characters[index];
  if (!current) return;

  const runId = ++state.playbackRunId;
  state.currentIndex = index;
  renderCurrentCharacter();
  if (!options.mute) speakText(current.char);
  const writer = state.writer;

  const strokeNames = current.strokeNames || [];
  const onComplete = options.onComplete || (() => {});

  const ready = await waitForWriterReady(runId, writer);
  if (!ready) return;

  const playStroke = async (strokeIndex) => {
    if (runId !== state.playbackRunId) return;

    if (strokeIndex >= strokeNames.length) {
      onComplete();
      return;
    }

    const strokeName = strokeNames[strokeIndex];
    if (strokeName && !options.mute) {
      speakText(pickStrokeNameVariant(strokeName));
    }

    await wait(160);
    const advanced = await drawNextStrokeSafely(runId, writer);
    if (runId !== state.playbackRunId) return;

    if (!advanced) {
      return;
    }

    if (strokeIndex >= strokeNames.length - 1) {
      onComplete();
      return;
    }

    await wait(STROKE_STEP_MS);
    await playStroke(strokeIndex + 1);
  };

  await wait(options.characterLead ?? CHARACTER_NAME_LEAD_MS);
  if (runId !== state.playbackRunId) return;
  await playStroke(0);
}

function playCurrentCharacter() {
  stopSentencePlayback();
  playCharacterStrokeByStroke(state.currentIndex, {
    onComplete: () => {
      const current = state.characters[state.currentIndex];
      if (!current) return;
      createWriter(current.char, 'step');
    },
  });
}

function playSentenceFrom(index) {
  if (!state.sentencePlayback) return;

  if (index >= state.characters.length) {
    stopSentencePlayback();
    setCurrentIndex(state.characters.length - 1);
    return;
  }

  playCharacterStrokeByStroke(index, {
    mute: true, // 播放整句时静音各个单字和笔画的报读
    onComplete: () => {
      if (!state.sentencePlayback) return;
      window.setTimeout(() => {
        if (!state.sentencePlayback) return;
        playSentenceFrom(index + 1);
      }, SENTENCE_CHARACTER_PAUSE_MS);
    },
  });
}

function buildCharacterData(chars) {
  return chars.map((char) => ({
    char,
    pinyin: getPinyin(char),
    strokeCount: getStrokeCount(char),
    strokeNames: getStrokeNames(char),
    manualStrokeIndex: 0,
  }));
}

function analyzeSentence() {
  const sentence = elements.sentenceInput.value.trim();
  const chars = getChineseCharacters(sentence);

  state.sentence = sentence;
  state.characters = buildCharacterData(chars);
  state.currentIndex = 0;
  stopSentencePlayback();

  elements.heroSentence.textContent = sentence || '还没有输入句子';
  elements.heroMeta.textContent = chars.length ? `拆成 ${chars.length} 个汉字` : '请先输入至少一个汉字';
  elements.charCountBadge.textContent = `${chars.length} 个字`;

  if (!chars.length) {
    elements.characterList.innerHTML = '';
    elements.currentCharacter.textContent = '字';
    elements.currentPinyin.textContent = '-';
    elements.currentIndex.textContent = '0';
    elements.totalCount.textContent = '0';
    elements.strokeCount.textContent = '-';
    clearWriter();
    setButtonsDisabled(true);
    updateStatus('没有识别到汉字，请输入一句包含中文汉字的话。');
    return;
  }

  setButtonsDisabled(false);
  renderCurrentCharacter();
  updateStatus('已拆分完成。可以点击拼音朗读，或点击汉字进入笔顺播放。');
}

function startRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    updateStatus('当前浏览器没有开放语音识别接口，可以直接使用系统键盘的语音输入。');
    return;
  }

  if (state.isListening) {
    state.recognition?.stop();
    updateStatus('正在结束语音输入...');
    return;
  }

  if (!state.recognition) {
    state.recognition = new SpeechRecognition();
    state.recognition.lang = 'zh-CN';
    state.recognition.interimResults = false;
    state.recognition.maxAlternatives = 1;
    state.recognition.continuous = false;

    state.recognition.addEventListener('start', () => {
      clearRecognitionStartTimer();
      state.isListening = true;
      state.recognitionStartedAt = Date.now();
      state.recognitionHadResult = false;
      updateListenButton();
      updateStatus('语音输入已开始，请现在说话。说完后再点一次按钮，或等待浏览器自动结束。');
    });

    state.recognition.addEventListener('result', (event) => {
      state.recognitionHadResult = true;
      const transcript = event.results[0][0].transcript;
      elements.sentenceInput.value = transcript;
      updateStatus(`识别完成：${transcript}`);
      analyzeSentence();
    });

    state.recognition.addEventListener('end', () => {
      clearRecognitionStartTimer();
      state.isListening = false;
      updateListenButton();
      if (state.recognitionHadResult) {
        return;
      }

      const elapsed = state.recognitionStartedAt ? Date.now() - state.recognitionStartedAt : 0;
      if (elapsed > 0 && elapsed < 1200) {
        updateStatus('语音输入被浏览器立即结束了，没有收到语音内容。通常是浏览器语音识别服务不可用，或当前浏览器对中文识别支持不完整。建议直接使用系统键盘语音输入。');
        return;
      }
      updateStatus('语音输入已结束，但这次没有识别到内容。请点击后立即说话，或直接使用系统键盘语音输入。');
    });

    state.recognition.addEventListener('error', (event) => {
      clearRecognitionStartTimer();
      state.isListening = false;
      updateListenButton();
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        updateStatus('麦克风权限被拒绝了。请在浏览器地址栏里允许麦克风访问，然后再试。');
        return;
      }
      if (event.error === 'no-speech') {
        updateStatus('没有听到语音。请重新点击“语音输入”后再说话。');
        return;
      }
      updateStatus(`语音输入不可用：${event.error}`);
    });
  }

  try {
    updateStatus('正在请求麦克风权限...');
    clearRecognitionStartTimer();
    state.recognitionStartedAt = 0;
    state.recognitionHadResult = false;
    state.recognitionStartTimer = window.setTimeout(() => {
      if (state.isListening) return;
      updateStatus('还没有开始录音。请检查浏览器是否弹出了麦克风权限提示，或确认你是通过 localhost / 127.0.0.1 打开的页面。');
    }, 4000);
    state.recognition.start();
  } catch (error) {
    clearRecognitionStartTimer();
    if (error.name === 'InvalidStateError') {
      updateStatus('语音输入已经在进行中。请直接说话，或点一次按钮结束。');
      state.isListening = true;
      updateListenButton();
      return;
    }
    throw error;
  }
}

function bindSwipe() {
  elements.writerSurface.addEventListener('touchstart', (event) => {
    state.swipeStartX = event.changedTouches[0].clientX;
  }, { passive: true });

  elements.writerSurface.addEventListener('touchend', (event) => {
    if (state.swipeStartX === null) return;
    const deltaX = event.changedTouches[0].clientX - state.swipeStartX;
    state.swipeStartX = null;

    if (Math.abs(deltaX) < 40) return;

    if (deltaX < 0) {
      moveCharacter(1);
    } else {
      moveCharacter(-1);
    }
  }, { passive: true });
}

function bindEvents() {
  elements.analyzeButton.addEventListener('click', analyzeSentence);
  elements.listenButton.addEventListener('click', startRecognition);
  elements.prevCharacterButton.addEventListener('click', () => moveCharacter(-1));
  elements.nextCharacterButton.addEventListener('click', () => moveCharacter(1));
  elements.speakCharacterButton.addEventListener('click', () => {
    const current = state.characters[state.currentIndex];
    if (current) speakText(current.char);
  });

  elements.nextStrokeButton.addEventListener('click', () => {
    if (!state.writer) return;
    const current = state.characters[state.currentIndex];
    const strokeNames = current?.strokeNames || [];
    const nextStrokeName = strokeNames[current.manualStrokeIndex || 0];
    if (nextStrokeName) {
      speakText(pickStrokeNameVariant(nextStrokeName));
    }

    const runId = ++state.playbackRunId;
    const writer = state.writer;

    waitForWriterReady(runId, writer).then(async (ready) => {
      if (!ready) return;
      const hasMore = await drawNextStrokeSafely(runId, writer);
      if (current) {
        current.manualStrokeIndex = hasMore ? (current.manualStrokeIndex || 0) + 1 : 0;
      }
      if (!hasMore) {
        createWriter(state.characters[state.currentIndex].char, 'step');
      }
    }).catch((error) => {
      console.error('Failed to draw next stroke:', error);
    });
  });

  elements.playCharacterButton.addEventListener('click', () => {
    playCurrentCharacter();
  });

  elements.playSentenceButton.addEventListener('click', () => {
    if (!state.characters.length) return;

    if (state.sentencePlayback) {
      stopSentencePlayback();
      setCurrentIndex(state.currentIndex);
      return;
    }

    state.sentencePlayback = true;
    elements.playSentenceButton.textContent = '停止整句播放';
    // 开始连续播放时，直接用高品质 TTS 连贯朗读整句
    speakText(state.sentence);
    playSentenceFrom(0);
  });

  if (elements.voiceSelect) {
    elements.voiceSelect.addEventListener('change', (event) => {
      const voice = event.target.value;
      // 停止当前可能的整句或笔顺朗读
      stopSentencePlayback();
      speak('您好，我是曦仔，这是当前语音风格的试听效果。', voice);
    });
  }

  elements.sentenceInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      analyzeSentence();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (!state.characters.length) return;
    if (event.target instanceof HTMLTextAreaElement) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveCharacter(-1);
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveCharacter(1);
    }
  });

  bindSwipe();
}

bindEvents();
updateListenButton();
analyzeSentence();
