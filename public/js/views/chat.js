/* Coach chat view. */
import { API } from '../core/api.js';
import { state, $app } from '../core/state.js';
import { downloadCsv } from '../core/util.js';
import { esc } from '../ui/index.js';

export function viewChat() {
  $app.innerHTML = `
    <h1 class="view-title">Coach <span class="scribble-underline">chat</span></h1>
    <p class="view-sub">The coach reads your progress spreadsheet and guides your next steps.
      <button class="btn small" id="chat-export">⬇ spreadsheet</button></p>
    <div class="chat-shell">
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-input-row">
        <textarea id="chat-input" placeholder="Ask what to study next, or how the site works…"></textarea>
        <button class="btn primary" id="chat-send">Send</button>
      </div>
      <div class="slide-actions" style="justify-content:flex-start;margin-top:10px">
        <button class="btn small ghost" id="chat-clear">Clear chat</button>
      </div>
    </div>`;
  document.getElementById('chat-export').addEventListener('click', downloadCsv);
  document.getElementById('chat-clear').addEventListener('click', () => {
    if (!confirm('Clear the chat window?')) return;
    state.chat = [{ role: 'assistant', content: "Hi! I'm your SketchLearn coach. I can see your progress spreadsheet and help you pick what to study next, or explain how to use the site. What are you curious about?" }];
    renderChatLog();
  });
  renderChatLog();
  const send = async () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    state.chat.push({ role: 'user', content: text });
    renderChatLog(true);
    try {
      const r = await API.post('/api/ai/chat', { messages: state.chat.filter(m => m.role !== 'pending') });
      state.chat.push({ role: 'assistant', content: r.reply });
    } catch (e) {
      state.chat.push({ role: 'assistant', content: `(The coach dropped their pencil: ${e.message})` });
    }
    renderChatLog();
  };
  document.getElementById('chat-send').addEventListener('click', send);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

function renderChatLog(thinking) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  log.innerHTML = state.chat.map(m =>
    `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.content)}</div>`).join('') +
    (thinking ? `<div class="msg ai">✏️ …</div>` : '');
  log.scrollTop = log.scrollHeight;
}
