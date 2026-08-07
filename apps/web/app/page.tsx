const navigation = ["Overview", "Inbox", "Clients", "Orders", "Production", "Finance", "Shipping", "Tasks"];

const cards = [
  { label: "Needs reply", value: "0", note: "Inbox is clear", tone: "coral" },
  { label: "Active orders", value: "0", note: "Ready for first order", tone: "violet" },
  { label: "Due this week", value: "0", note: "No deadlines yet", tone: "blue" },
  { label: "Awaiting payment", value: "€0", note: "No open balances", tone: "gold" }
];

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span>Y</span><div><strong>Yoleotard</strong><small>CRM</small></div></div>
        <nav>{navigation.map((item, index) => <a className={index === 0 ? "active" : ""} href="#" key={item}>{item}</a>)}</nav>
        <div className="sidebar-footer"><div className="avatar">YO</div><div><strong>Owner</strong><small>System administrator</small></div></div>
      </aside>
      <section className="workspace">
        <header>
          <div><p className="eyebrow">Friday, 7 August</p><h1>Good morning</h1><p className="subtitle">Here is what needs attention across Yoleotard today.</p></div>
          <div className="actions"><button className="search">Search clients, orders…</button><button className="primary">+ New order</button></div>
        </header>
        <div className="metrics">{cards.map(card => <article className={`metric ${card.tone}`} key={card.label}><p>{card.label}</p><strong>{card.value}</strong><small>{card.note}</small></article>)}</div>
        <div className="grid">
          <article className="panel focus">
            <div className="panel-title"><div><p className="eyebrow">Daily focus</p><h2>Nothing urgent yet</h2></div><span className="badge">All clear</span></div>
            <p>Add the first client and order to start building today's operational queue.</p>
            <div className="empty-illustration"><span>Y</span><div><b>Fast path</b><small>Client → athlete → order → deposit → production slot</small></div></div>
            <button className="secondary">Create first client</button>
          </article>
          <article className="panel">
            <div className="panel-title"><div><p className="eyebrow">Production</p><h2>Capacity</h2></div><button className="link">Open calendar</button></div>
            <div className="week"><span>Mon<i /></span><span>Tue<i /></span><span>Wed<i /></span><span>Thu<i /></span><span>Fri<i /></span><span>Sat<i /></span></div>
            <div className="legend"><span><i className="available" />Available</span><span><i className="booked" />Booked</span></div>
          </article>
        </div>
        <article className="panel recent">
          <div className="panel-title"><div><p className="eyebrow">Recent activity</p><h2>Client and order history</h2></div><button className="link">View all</button></div>
          <div className="empty-row">Audit-safe activity will appear here after the first business action.</div>
        </article>
      </section>
    </main>
  );
}
