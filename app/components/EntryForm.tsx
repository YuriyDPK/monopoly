type EntryFormProps = {
  name: string;
  room: string;
  busy: boolean;
  ready: boolean;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCreateOwn: () => void;
};

export function EntryForm({ name, room, busy, ready, onNameChange, onSubmit, onCreateOwn }: EntryFormProps) {
  return <form className="welcome-panel" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <div className="panel-kicker"><span />{room ? `ПРИГЛАШЕНИЕ В КОМНАТУ ${room}` : 'ВАША ИГРА НАЧИНАЕТСЯ ЗДЕСЬ'}</div>
    <h2>{room ? <>Вас ждут<br /><i>за столом.</i></> : <>Соберите друзей.<br /><i>Постройте империю.</i></>}</h2>
    <p>{room ? 'Как вас представить другим игрокам? Введите имя и присоединяйтесь к компании.' : 'Знакомая игра, большие сделки и немного удачи. Создайте комнату и отправьте друзьям ссылку.'}</p>
    <label>ВАШЕ ИМЯ<input name="playerName" autoComplete="nickname" value={name} onChange={event => onNameChange(event.target.value)} placeholder="Как вас зовут?" maxLength={20} disabled={busy} required /></label>
    <button className="primary big" type="submit" disabled={!ready || busy}>{!ready ? 'Подключаемся…' : busy ? 'Входим…' : room ? 'Присоединиться' : 'Создать комнату'}<span>↗</span></button>
    {room && <button className="text-button" type="button" onClick={onCreateOwn} disabled={busy}>Создать свою комнату</button>}
    <div className="panel-foot">✦ &nbsp; ОТ 2 ДО 6 ИГРОКОВ <span>•</span> &nbsp; ОДНА БОЛЬШАЯ ИГРА</div>
  </form>;
}
