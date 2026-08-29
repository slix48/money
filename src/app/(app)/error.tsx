"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="state-page">
      <span className="state-icon error"><AlertTriangle size={22} /></span>
      <h1>Financial data could not be loaded</h1>
      <p>The error was contained and no changes were made. Try loading the view again.</p>
      <button type="button" className="button button-secondary" onClick={reset}>
        <RotateCcw size={16} /> Retry
      </button>
    </div>
  );
}
