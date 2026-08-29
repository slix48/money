export default function AppLoading() {
  return (
    <div className="page-stack" aria-busy="true" aria-label="Loading financial data">
      <div className="skeleton skeleton-title" />
      <div className="metric-strip">
        {Array.from({ length: 4 }, (_, index) => <div className="skeleton skeleton-metric" key={index} />)}
      </div>
      <div className="dashboard-grid">
        <div className="skeleton skeleton-panel wide" />
        <div className="skeleton skeleton-panel" />
      </div>
    </div>
  );
}
