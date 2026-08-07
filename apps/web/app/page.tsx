import { ru } from "../lib/i18n";

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span>Y</span><div><strong>{ru.brand}</strong><small>{ru.product}</small></div></div>
        <nav>{ru.navigation.map((item, index) => <a className={index === 0 ? "active" : ""} href="#" key={item}>{item}</a>)}</nav>
        <div className="sidebar-footer"><div className="avatar">YO</div><div><strong>{ru.owner}</strong><small>{ru.administrator}</small></div></div>
      </aside>
      <section className="workspace">
        <header>
          <div><p className="eyebrow">{ru.date}</p><h1>{ru.greeting}</h1><p className="subtitle">{ru.summary}</p></div>
          <div className="actions"><button className="search">{ru.search}</button><button className="primary">{ru.newOrder}</button></div>
        </header>
        <div className="metrics">{ru.metrics.map((card, index) => <article className={`metric ${card.tone}`} key={card.label}><p>{card.label}</p><strong>{index === 3 ? "€0" : "0"}</strong><small>{card.note}</small></article>)}</div>
        <div className="grid">
          <article className="panel focus">
            <div className="panel-title"><div><p className="eyebrow">{ru.dailyFocus}</p><h2>{ru.nothingUrgent}</h2></div><span className="badge">{ru.allClear}</span></div>
            <p>{ru.firstAction}</p>
            <div className="empty-illustration"><span>Y</span><div><b>{ru.fastPath}</b><small>{ru.fastPathText}</small></div></div>
            <button className="secondary">{ru.createClient}</button>
          </article>
          <article className="panel">
            <div className="panel-title"><div><p className="eyebrow">{ru.production}</p><h2>{ru.capacity}</h2></div><button className="link">{ru.openCalendar}</button></div>
            <div className="week">{ru.weekdays.map(day => <span key={day}>{day}<i /></span>)}</div>
            <div className="legend"><span><i className="available" />{ru.available}</span><span><i className="booked" />{ru.booked}</span></div>
          </article>
        </div>
        <article className="panel recent">
          <div className="panel-title"><div><p className="eyebrow">{ru.recentActivity}</p><h2>{ru.history}</h2></div><button className="link">{ru.viewAll}</button></div>
          <div className="empty-row">{ru.emptyHistory}</div>
        </article>
      </section>
    </main>
  );
}
