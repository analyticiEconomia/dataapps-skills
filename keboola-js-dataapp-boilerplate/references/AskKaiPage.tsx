// Copy this into your app as `src/AskKaiPage.tsx` (or paste the sendMessage
// logic into your existing chat page). It handles:
//
// - POST /api/chat/start (kicks off Kai on the server) then long-polls
//   GET /api/chat/poll for chunks; NOT SSE (the Keboola ingress drops it).
// - SSE-format parsing that matches keboola/kai-client: type='text-delta'
//   with a `delta` field (not `textDelta`), plus tool-input-available and error.
// - Icon post-processing: Kai emits `icon:xxx:` placeholders — mapped to emoji.
// - `next_actions` block stripping so the raw markdown block doesn't render.
//
// Requires: nothing beyond React + lucide-react. Style hooks are Tailwind-ish
// but you can restyle freely.

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Send, Loader2 } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const KAI_ICON_MAP: Record<string, string> = {
  check: '✅', 'circle-check': '✅', success: '✅',
  warning: '⚠️', 'triangle-exclamation': '⚠️', exclamation: '⚠️',
  error: '❌', xmark: '✗', 'circle-xmark': '❌',
  info: 'ℹ️', 'circle-info': 'ℹ️', note: '📝',
  question: '❓', 'circle-question': '❓',
  chart: '📊', 'chart-bar': '📊', 'chart-line': '📈', table: '📋',
  trend: '📈', up: '📈', down: '📉',
  database: '🗄️', folder: '📁', file: '📄', receipt: '🧾',
  gear: '⚙️', sparkles: '✨', star: '⭐', bolt: '⚡',
  money: '💰', 'money-bill': '💰', coins: '🪙',
  clock: '🕐', calendar: '📅', flag: '🚩', target: '🎯',
  search: '🔍', link: '🔗', user: '👤', users: '👥',
  lightbulb: '💡', fire: '🔥', bank: '🏦',
};

function postProcessKai(text: string): string {
  if (!text) return text;
  return text.replace(/icon:([a-z0-9-]+):?/gi, (_m, name: string) => KAI_ICON_MAP[name.toLowerCase()] || '•');
}

function stripNextActions(text: string): string {
  // Kai may send a trailing ```next_actions … ``` block; hide it (or parse it
  // into buttons in your UI — omitted here for brevity).
  return text.replace(/```next_actions[\s\S]*?(```|$)/g, '').trim();
}

export function AskKaiPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatId] = useState(() => generateUUID());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = async () => {
    const userMessage = input.trim();
    if (!userMessage || isLoading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const startRes = await fetch('/api/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: chatId,
          message: {
            id: generateUUID(),
            role: 'user',
            parts: [{ type: 'text', text: userMessage }],
          },
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        }),
      });
      if (!startRes.ok) {
        const errBody = await startRes.text().catch(() => '');
        let errMsg = errBody;
        try {
          errMsg = JSON.parse(errBody).error || errBody;
        } catch {
          /* keep raw */
        }
        throw new Error(`${startRes.status}: ${errMsg || 'unknown error'}`);
      }
      const { streamId } = await startRes.json();

      let buffer = '';
      let assistantContent = '';
      let from = 0;
      let consecutiveEmpty = 0;

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      const applyEvent = (event: any) => {
        // Kai SSE format per keboola/kai-client:
        //   text-delta:            { type:'text-delta', delta:'...' }        ← NOT textDelta
        //   text:                  { type:'text', text:'...' }
        //   tool-input-available:  { type:'tool-input-available', toolName, toolCallId }
        //   error:                 { type:'error', message:'...' }
        //   finish:                { type:'finish' }
        let text = '';
        if (event.type === 'text-delta') {
          text = event.delta || event.textDelta || '';
        } else if (event.type === 'text' && event.text) {
          text = event.text;
        }
        if (text) {
          assistantContent += text;
        } else if (event.type === 'tool-input-available' || event.type === 'tool-call') {
          const name = event.toolName || event.tool_name || event.name || 'tool';
          assistantContent += `\n_[Calling tool: ${name}]_\n`;
        } else if (event.type === 'error') {
          assistantContent += `\n**Kai error:** ${event.message || 'unknown'}\n`;
        } else {
          return;
        }
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: assistantContent };
          return next;
        });
      };

      while (true) {
        let pollJson: any = null;
        let pollErr: string | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const pollRes = await fetch(`/api/chat/poll?id=${encodeURIComponent(streamId)}&from=${from}`);
            if (!pollRes.ok) {
              const body = await pollRes.text().catch(() => '');
              throw new Error(`poll ${pollRes.status}: ${body.slice(0, 200)}`);
            }
            pollJson = await pollRes.json();
            pollErr = null;
            break;
          } catch (e) {
            pollErr = e instanceof Error ? e.message : String(e);
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
        if (!pollJson) throw new Error(pollErr || 'poll failed after retries');

        const { chunk, total, done, error } = pollJson as {
          chunk: string;
          total: number;
          done: boolean;
          error: string | null;
        };
        if (error) {
          assistantContent += (assistantContent ? '\n\n' : '') + `**Error:** ${error}`;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content: assistantContent };
            return next;
          });
          break;
        }
        if (chunk && chunk.length > 0) {
          consecutiveEmpty = 0;
          from = total;
          buffer += chunk;
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === '[DONE]') continue;
              try {
                applyEvent(JSON.parse(jsonStr));
              } catch {
                /* skip invalid JSON */
              }
            }
          }
        } else {
          consecutiveEmpty++;
        }
        if (done) break;
        await new Promise((r) => setTimeout(r, consecutiveEmpty > 5 ? 1000 : 300));
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <MessageCircle className="text-purple-400" /> Ask Kai
        </h1>
        <p className="text-sm text-slate-400">Ask Kai about the data, its origin, and how metrics are computed.</p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                msg.role === 'user'
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                  : 'bg-slate-800/70 text-slate-200 border border-slate-700/50'
              }`}
            >
              <div className="text-sm whitespace-pre-wrap">
                {msg.role === 'assistant'
                  ? postProcessKai(stripNextActions(msg.content)) ||
                    (isLoading && i === messages.length - 1 ? '…' : '')
                  : msg.content}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="mt-4 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Kai…"
          rows={1}
          className="flex-1 px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
        />
        <button
          onClick={sendMessage}
          disabled={isLoading || !input.trim()}
          className="px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white disabled:opacity-40"
        >
          {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
