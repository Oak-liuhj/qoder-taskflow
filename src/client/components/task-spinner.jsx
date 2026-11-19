import React from 'react';
export function TaskSpinner({ label = '进行中' }) {
  return <svg className="tf-task-spinner" viewBox="0 0 24 24" role="img" aria-label={label}><circle cx="12" cy="12" r="9" opacity=".2"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>;
}
