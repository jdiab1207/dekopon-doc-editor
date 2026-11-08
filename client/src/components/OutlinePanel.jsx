export default function OutlinePanel({ headings, onJump }) {
  return (
    <aside className="outline-pane">
      <h3 className="pane-title">Document outline</h3>
      {!headings.length ? (
        <p className="ai-hint">Add headings to build an outline.</p>
      ) : (
        <div className="outline-list">
          {headings.map((h) => (
            <button
              key={h.id}
              className={`outline-h${h.level}`}
              onClick={() => onJump(h.id)}
              type="button"
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
