import React from 'react';

// Empty boxes and list lines identify pending work; completion uses its own tick.
export function TaskIcon(props) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <rect x="3" y="3" width="4" height="4" rx="1"/>
    <rect x="3" y="10" width="4" height="4" rx="1"/>
    <rect x="3" y="17" width="4" height="4" rx="1"/>
    <path d="M11 5h10M11 12h10M11 19h10"/>
  </svg>;
}
