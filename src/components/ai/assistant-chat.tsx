"use client";

import {
  ArrowUp,
  Calculator,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { AssistantReply } from "@/ai/assistant";

interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  reply?: AssistantReply;
}

const prompts = [
  "What changed financially this month?",
  "How much did I spend eating out?",
  "Did any of my bills increase?",
  "How much did I actually save this month?",
  "How much of my portfolio is Apple?",
  "Can I afford a $7,000 purchase without using my emergency fund?",
];

export function AssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "ASSISTANT",
      content: "Ask a question about your balances, spending, income, recurring costs, investments, goals, or monthly changes.",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function send(question: string) {
    const trimmed = question.trim();
    if (trimmed.length < 2 || pending) return;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "USER",
      content: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/ai/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const body = (await response.json()) as AssistantReply | { error?: string };
      if (!response.ok || !("answer" in body)) {
        setError("error" in body ? body.error ?? "Unable to answer that question." : "Unable to answer that question.");
        return;
      }
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "ASSISTANT",
          content: body.answer,
          reply: body,
        },
      ]);
    } catch {
      setError("Unable to reach the financial intelligence service.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  return (
    <section className="assistant-workspace panel">
      <header className="assistant-header">
        <span className="assistant-icon"><Sparkles size={18} /></span>
        <div><h2>Financial assistant</h2><p>Read-only · grounded in your MoneyOS data</p></div>
        <span className="badge badge-positive"><LockKeyhole size={11} /> Tool-restricted</span>
      </header>
      <div className="chat-thread" aria-live="polite">
        {messages.map((message) => (
          <article className={`chat-message ${message.role.toLowerCase()}`} key={message.id}>
            <div className="chat-avatar">{message.role === "USER" ? "You" : <Sparkles size={15} />}</div>
            <div className="chat-bubble">
              <p>{message.content}</p>
              {message.reply?.calculation && message.reply.calculation.length > 0 && (
                <details className="calculation-receipt">
                  <summary><Calculator size={13} /> Show calculation</summary>
                  <ul>{message.reply.calculation.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>
                </details>
              )}
              {message.reply?.note && <p className="assistant-note"><CircleAlert size={13} /> {message.reply.note}</p>}
              {message.reply && (
                <div className="tool-provenance">
                  <Wrench size={12} />
                  {message.reply.toolsUsed.map((tool) => <span className="badge" key={tool}>{tool}</span>)}
                  <span className="badge badge-demo">{message.reply.dataSource.toLowerCase()} data</span>
                </div>
              )}
            </div>
          </article>
        ))}
        {messages.length === 1 && (
          <div className="prompt-grid">
            {prompts.map((prompt) => <button type="button" key={prompt} onClick={() => void send(prompt)}>{prompt}</button>)}
          </div>
        )}
        {pending && (
          <article className="chat-message assistant"><div className="chat-avatar"><Sparkles size={15} /></div><div className="chat-bubble thinking"><LoaderCircle size={15} className="spin" /> Calculating from financial tools</div></article>
        )}
      </div>
      <footer className="chat-composer-wrap">
        {error && <p className="form-error" role="alert">{error}</p>}
        <form className="chat-composer" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your financial data"
            maxLength={600}
            rows={2}
            aria-label="Financial question"
          />
          <button type="submit" disabled={pending || input.trim().length < 2} aria-label="Send question"><ArrowUp size={17} /></button>
        </form>
        <p>MoneyOS calculates financial facts in application tools. Assistant text cannot move money or perform financial actions.</p>
      </footer>
    </section>
  );
}
