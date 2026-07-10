'use client';
/* Coach chat view. Ported from public/js/views/chat.js. */
import { useEffect, useRef, useState } from 'react';
import { API } from '@/lib/api';
import { appState, initialCoachGreeting, type ChatMessage } from '@/lib/app-state';
import { downloadCsv } from '@/lib/util';

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>(appState.chat);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the shared appState.chat in sync so it persists across navigation.
  useEffect(() => { appState.chat = messages; }, [messages]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [messages, thinking]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setThinking(true);
    try {
      const r = await API.post('/api/ai/chat', { messages: next });
      setMessages([...next, { role: 'assistant', content: r.reply }]);
    } catch (e: any) {
      setMessages([...next, { role: 'assistant', content: `(The coach dropped their pencil: ${e.message})` }]);
    }
    setThinking(false);
  };

  const clear = () => {
    if (!confirm('Clear the chat window?')) return;
    setMessages([initialCoachGreeting]);
  };

  return (
    <>
      <h1 className="view-title">Coach <span className="scribble-underline">chat</span></h1>
      <p className="view-sub">The coach reads your progress spreadsheet and guides your next steps.{' '}
        <button className="btn small" id="chat-export" onClick={downloadCsv}>⬇ spreadsheet</button></p>
      <div className="chat-shell">
        <div className="chat-log" id="chat-log" ref={logRef}>
          {messages.map((m, i) => <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'ai'}`}>{m.content}</div>)}
          {thinking && <div className="msg ai">✏️ …</div>}
        </div>
        <div className="chat-input-row">
          <textarea id="chat-input" placeholder="Ask what to study next, or how the site works…"
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn primary" id="chat-send" onClick={send}>Send</button>
        </div>
        <div className="slide-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
          <button className="btn small ghost" id="chat-clear" onClick={clear}>Clear chat</button>
        </div>
      </div>
    </>
  );
}
