import { useLayoutEffect, useRef, useState } from 'react';
import type { Game } from '@/lib/game';
import { appendLogHistory, createLogHistory } from './log-history';

const emptyLog: string[] = [];

function eventKind(line: string) {
  if (/«Шанс»|карточк/.test(line)) return { label: 'Шанс', icon: '?', tone: 'property' };
  if (/платит|штраф|списан|банкрот|возвращается банку/.test(line)) return { label: 'Платёж', icon: '↗', tone: 'payment' };
  if (/получает|выигрывает|выплата/.test(line)) return { label: 'Доход', icon: '+', tone: 'income' };
  if (/покупает|закладывает|выкупает|улучшает|продаёт|сделк|аукцион/.test(line)) return { label: 'Бизнес', icon: '◇', tone: 'property' };
  return { label: 'Событие', icon: '·', tone: 'game' };
}

function EventText({ text }: { text: string }) {
  return <>{text.split(/(\d[\d, ]*k)/g).map((part, index) => /\dk$/.test(part) ? <strong key={index}>{part}</strong> : part)}</>;
}

export function ActivityLog({ game, sendMessage }: { game: Game | null; sendMessage: (message: string) => Promise<boolean> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const source = game?.log || emptyLog;
  const [history, setHistory] = useState(() => createLogHistory(source));
  if (history.source !== source) setHistory(appendLogHistory(history, source));
  const entries = history.entries;
  const players = [...(game?.players || [])].sort((a, b) => b.name.length - a.name.length);

  useLayoutEffect(() => {
    if (followLatest.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [entries]);

  const scrollToLatest = () => {
    followLatest.current = true;
    setAwayFromBottom(false);
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  };

  return <aside className="activity" aria-label="Журнал игры">
    <div className="activity-heading"><div><span className="eyebrow">ЗА ИГРОВЫМ СТОЛОМ</span><h2>События и чат</h2></div><span className="activity-live">● LIVE</span></div>
    <div className="activity-divider" />
    <div className="activity-feed-wrap">
      <div className="activity-content" ref={viewport} role="log" aria-label="События игры, новые внизу" aria-live="polite" aria-relevant="additions" onScroll={event => {
        const element = event.currentTarget;
        const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        followLatest.current = atBottom;
        setAwayFromBottom(!atBottom);
      }}>
        {entries.length ? <div className="activity-entries">{entries.map(({ id, text: line }, index) => {
          const speaker = players.find(player => line.startsWith(`${player.name}: `) && !/^(джекпот —|«Шанс»|наступил срок возврата кредита)/.test(line.slice(player.name.length + 2)));
          const kind = eventKind(line);
          return <div className={`feed-event ${speaker ? 'feed-chat' : `feed-${kind.tone}`} ${index === entries.length - 1 ? 'feed-latest' : ''}`} key={id}>
            <span className="feed-icon" style={speaker ? { color: speaker.color } : undefined}>{speaker ? speaker.name.slice(0, 1).toUpperCase() : kind.icon}</span>
            <div className="feed-body"><div className="feed-label">{speaker ? speaker.name : kind.label}{index === entries.length - 1 && <span>сейчас</span>}</div><p>{speaker ? line.slice(speaker.name.length + 2) : <EventText text={line} />}</p></div>
          </div>;
        })}</div> : <div className="activity-empty"><div>✳</div><strong>История вашей партии</strong><p>Ходы, сделки и сообщения друзей появятся здесь. Новые события — внизу.</p></div>}
      </div>
      {awayFromBottom && <button className="activity-jump" onClick={scrollToLatest}>К последним событиям ↓</button>}
    </div>
    {game && <form className="chat" onSubmit={async event => {
      event.preventDefault();
      const value = message.trim();
      if (!value || sending) return;
      setSending(true);
      try { if (await sendMessage(value)) setMessage(current => current.trim() === value ? '' : current); }
      finally { setSending(false); }
    }}><input aria-label="Сообщение игрокам" value={message} onChange={event => setMessage(event.target.value)} maxLength={160} placeholder="Сообщение за столом…" /><button aria-label="Отправить сообщение" disabled={sending || !message.trim()}>↑</button></form>}
    <div className="activity-footer"><span>НОВЫЕ СОБЫТИЯ ВНИЗУ</span><span>✦</span></div>
  </aside>;
}
