// Copy this into your app as `src/AskKaiPage.tsx` (or paste the sendMessage
// logic into your existing chat page). It handles:
//
// - POST /api/chat/start (kicks off Kai on the server) then long-polls
//   GET /api/chat/poll for chunks; NOT SSE (the Keboola ingress drops it).
// - SSE-format parsing that matches keboola/kai-client: type='text-delta'
//   with a `delta` field (not `textDelta`), plus tool-input-available and error.
// - Icon post-processing: Kai emits `icon:xxx:` placeholders — mapped to emoji.
// - `next_actions` block stripping so the raw markdown block doesn't render.
// - Table/CSV rendering: Kai frequently answers "export this as CSV" requests
//   with a ```csv fenced block or a markdown pipe table, NOT a real file. This
//   component had no markdown/table parser at all — it dumped everything through
//   `whitespace-pre-wrap`, so a CSV block showed up as one unreadable wall of
//   commas (or a pipe-table as misaligned `| a | b |` text) with nothing to
//   click. `extractKaiTables` below detects those blocks and renders them as a
//   real `<table>` with a working "Download CSV" button that writes a properly
//   quoted, semicolon-delimited, UTF-8-BOM file — semicolons + BOM because
//   Excel on a cs-CZ locale treats `,` as the decimal separator and mis-opens
//   comma-delimited / non-BOM files as a single garbled column.
//
// Requires: nothing beyond React + lucide-react. Style hooks are Tailwind-ish
// but you can restyle freely.

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Send, Loader2, Download } from 'lucide-react';

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

// --- Table / CSV rendering -------------------------------------------------

type KaiSegment = { type: 'text'; content: string } | { type: 'table'; rows: string[][] };

function parseDelimited(block: string): string[][] {
  const delimiter = block.includes('\t') ? '\t' : ',';
  return block
    .trim()
    .split('\n')
    .map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, '')));
}

function parseMarkdownTable(block: string): string[][] | null {
  const lines = block.trim().split('\n').filter(Boolean);
  if (lines.length < 2 || !lines[0].includes('|')) return null;
  // second line must be the |---|---| separator
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1])) return null;
  const stripPipes = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '');
  return [lines[0], ...lines.slice(2)].map((l) => stripPipes(l).split('|').map((c) => c.trim()));
}

// Splits Kai's message into plain-text segments and detected table segments
// (```csv / ```tsv fenced blocks, or markdown pipe tables) so each table can
// render as a real <table> instead of raw pre-wrap text.
function extractKaiTables(text: string): KaiSegment[] {
  const segments: KaiSegment[] = [];
  const fenceRe = /```(csv|tsv)\n([\s\S]*?)```/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text))) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'table', rows: parseDelimited(match[2]) });
    lastIndex = fenceRe.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ type: 'text', content: text.slice(lastIndex) });

  // Second pass: pull markdown pipe tables out of the remaining text segments.
  const final: KaiSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'table') {
      final.push(seg);
      continue;
    }
    const lines = seg.content.split('\n');
    let buffer: string[] = [];
    let textBuffer: string[] = [];
    const flushText = () => {
      if (textBuffer.length) final.push({ type: 'text', content: textBuffer.join('\n') });
      textBuffer = [];
    };
    const flushTable = () => {
      if (buffer.length >= 2) {
        const rows = parseMarkdownTable(buffer.join('\n'));
        if (rows) {
          final.push({ type: 'table', rows });
        } else {
          textBuffer.push(...buffer);
        }
      } else {
        textBuffer.push(...buffer);
      }
      buffer = [];
    };
    for (const line of lines) {
      if (line.includes('|')) {
        buffer.push(line);
      } else {
        flushTable();
        textBuffer.push(line);
      }
    }
    flushTable();
    flushText();
  }
  return final;
}

function downloadCsv(rows: string[][], filename = 'kai-export.csv') {
  // Semicolon delimiter + UTF-8 BOM: Excel on cs-CZ locale uses ',' as the
  // decimal separator and mis-parses comma-delimited / non-BOM files.
  const escape = (cell: string) => (/[;"\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const csv = rows.map((row) => row.map(escape).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function KaiTable({ rows }: { rows: string[][] }) {
  if (!rows.length) return null;
  const [header, ...body] = rows;
  return (
    <div className="my-2 rounded-lg border border-slate-700/50 overflow-hidden">
      <div className="flex justify-end px-2 py-1 bg-slate-800/70">
        <button
          onClick={() => downloadCsv(rows)}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
        >
          <Download size={12} /> CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i} className="text-left px-3 py-1.5 bg-slate-800/50 text-slate-300 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="border-t border-slate-700/50">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-slate-200 whitespace-nowrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KaiMessage({ content }: { content: string }) {
  const segments = extractKaiTables(content);
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'table' ? (
          <KaiTable key={i} rows={seg.rows} />
        ) : seg.content.trim() ? (
          <div key={i} className="whitespace-pre-wrap">
            {seg.content}
          </div>
        ) : null
      )}
    </>
  );
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
              <div className="text-sm">
                {msg.role === 'assistant' ? (
                  postProcessKai(stripNextActions(msg.content)) ? (
                    <KaiMessage content={postProcessKai(stripNextActions(msg.content))} />
                  ) : isLoading && i === messages.length - 1 ? (
                    '…'
                  ) : null
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
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
