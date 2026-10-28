// A small hand-inked icon set. Each icon is a soft wash plus a rounded stroke, so it reads
// at a glance and matches the phone app's cut-paper art without needing image files.
const W = 'fill="currentColor" fill-opacity=".16" stroke="none"';
const PATHS = {
  home: `<path ${W} d="M4 11 12 4l8 7v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M3 11.6 12 3.8l9 7.8M5.2 10v9.6c0 .5.4.9.9.9H10v-5.6h4v5.6h3.9c.5 0 .9-.4.9-.9V10"/>`,
  phone: `<rect ${W} x="6.2" y="2.6" width="11.6" height="18.8" rx="2.6"/><rect x="6.2" y="2.6" width="11.6" height="18.8" rx="2.6"/><path d="M10.4 5.2h3.2M11 18.6h2"/>`,
  mac: `<rect ${W} x="3" y="4" width="18" height="12" rx="1.8"/><rect x="3" y="4" width="18" height="12" rx="1.8"/><path d="M8.5 20.4h7M12 16v4.4"/>`,
  wifi: `<path d="M2.8 9.2a13.4 13.4 0 0 1 18.4 0M6 12.6a8.6 8.6 0 0 1 12 0M9.2 16a3.9 3.9 0 0 1 5.6 0"/><circle cx="12" cy="19.2" r="1.3" fill="currentColor"/>`,
  house: `<path ${W} d="M3.6 10.6 12 3.6l8.4 7v9.8H3.6Z"/><path d="M2.6 11.4 12 3.4l9.4 8M4.6 9.8v10.6h14.8V9.8"/>`,
  lock: `<rect ${W} x="4.6" y="10.4" width="14.8" height="10.6" rx="2.4"/><rect x="4.6" y="10.4" width="14.8" height="10.6" rx="2.4"/><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8M12 14.6v2.4"/>`,
  cloudOff: `<path ${W} d="M7 18.4h10.6a3.9 3.9 0 0 0 .4-7.8 6 6 0 0 0-11.6-1.4A4.6 4.6 0 0 0 7 18.4Z"/><path d="M7 18.4h10.6a3.9 3.9 0 0 0 .4-7.8 6 6 0 0 0-11.6-1.4A4.6 4.6 0 0 0 7 18.4Z"/><path d="M3.4 3.4l17.2 17.2" stroke-width="2.2"/>`,
  brain: `<path ${W} d="M12 4.6c-1-1.6-4.6-1.6-5.2 1.2-2.4.2-3.4 3-1.8 4.6-1.8 1.4-1.2 4.6 1.2 5 .2 2.8 3.6 3.8 5.8 2Zm0 0c1-1.6 4.6-1.6 5.2 1.2 2.4.2 3.4 3 1.8 4.6 1.8 1.4 1.2 4.6-1.2 5-.2 2.8-3.6 3.8-5.8 2Z"/><path d="M12 4.6c-1-1.6-4.6-1.6-5.2 1.2-2.4.2-3.4 3-1.8 4.6-1.8 1.4-1.2 4.6 1.2 5 .2 2.8 3.6 3.8 5.8 2V4.6c1-1.6 4.6-1.6 5.2 1.2 2.4.2 3.4 3 1.8 4.6 1.8 1.4 1.2 4.6-1.2 5-.2 2.8-3.6 3.8-5.8 2M8.6 9.4c1 .2 1.8 1 2 2M15.4 9.4c-1 .2-1.8 1-2 2M8.4 14.2h1.8M15.6 14.2h-1.8"/>`,
  pen: `<path ${W} d="m14.8 4.6 4.6 4.6L9 19.6l-5.4.8.8-5.4Z"/><path d="m14.8 4.6 4.6 4.6L9 19.6l-5.4.8.8-5.4Zm-2 2 4.6 4.6M4.4 15l4.6 4.6"/>`,
  mic: `<rect ${W} x="8.6" y="2.8" width="6.8" height="11.6" rx="3.4"/><rect x="8.6" y="2.8" width="6.8" height="11.6" rx="3.4"/><path d="M5.4 11a6.6 6.6 0 0 0 13.2 0M12 17.6v3.6M8.8 21.2h6.4"/>`,
  search: `<circle ${W} cx="10.4" cy="10.4" r="6.4"/><circle cx="10.4" cy="10.4" r="6.4"/><path d="m15.2 15.2 5.4 5.4M7.6 9a3.2 3.2 0 0 1 2.4-2"/>`,
  picture: `<rect ${W} x="3" y="4.2" width="18" height="15.6" rx="2.4"/><rect x="3" y="4.2" width="18" height="15.6" rx="2.4"/><circle cx="8.6" cy="9.4" r="1.8"/><path d="m3.4 17.4 5.2-5 4 3.8 2.6-2.4 5.6 5"/>`,
  eye: `<path ${W} d="M2.4 12s3.6-6.6 9.6-6.6 9.6 6.6 9.6 6.6-3.6 6.6-9.6 6.6S2.4 12 2.4 12Z"/><path d="M2.4 12s3.6-6.6 9.6-6.6 9.6 6.6 9.6 6.6-3.6 6.6-9.6 6.6S2.4 12 2.4 12Z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  scan: `<path d="M3.6 8V5.4c0-1 .8-1.8 1.8-1.8H8M16 3.6h2.6c1 0 1.8.8 1.8 1.8V8M20.4 16v2.6c0 1-.8 1.8-1.8 1.8H16M8 20.4H5.4c-1 0-1.8-.8-1.8-1.8V16"/><path ${W} d="M7.4 7.4h9.2v9.2H7.4Z"/><path d="M7.6 9.6h8.8M7.6 12h8.8M7.6 14.4h5.6"/>`,
  globe: `<circle ${W} cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z"/>`,
  hourglass: `<path ${W} d="M8 19.2c0-2.4 4-3.4 4-5.2 0 1.8 4 2.8 4 5.2Z"/><path d="M6 3h12M6 21h12M7.4 3c0 4.4 4.6 5.6 4.6 9s-4.6 4.6-4.6 9M16.6 3c0 4.4-4.6 5.6-4.6 9s4.6 4.6 4.6 9"/>`,
  check: `<path d="m4.6 12.6 4.6 4.6L19.6 6.8" stroke-width="2.6"/>`,
  cross: `<path d="M6 6l12 12M18 6 6 18" stroke-width="2.4"/>`,
  moon: `<path ${W} d="M19.6 14.6A8 8 0 0 1 9.4 4.4a8 8 0 1 0 10.2 10.2Z"/><path d="M19.6 14.6A8 8 0 0 1 9.4 4.4a8 8 0 1 0 10.2 10.2Z"/><path d="M15.4 3.6h3l-3 3.4h3" stroke-width="1.5"/>`,
  speaker: `<path ${W} d="M4 9.4h3.4L12 5.2v13.6l-4.6-4.2H4Z"/><path d="M4 9.4h3.4L12 5.2v13.6l-4.6-4.2H4ZM15.6 9a4.2 4.2 0 0 1 0 6M18.4 6.4a8 8 0 0 1 0 11.2"/>`,
  book: `<path ${W} d="M12 6.4C9.8 4.8 6.4 4.4 3.4 5v13.6c3-.6 6.4-.2 8.6 1.4 2.2-1.6 5.6-2 8.6-1.4V5c-3-.6-6.4-.2-8.6 1.4Z"/><path d="M12 6.4C9.8 4.8 6.4 4.4 3.4 5v13.6c3-.6 6.4-.2 8.6 1.4m0-13.6c2.2-1.6 5.6-2 8.6-1.4v13.6c-3-.6-6.4-.2-8.6 1.4m0-13.6V20"/>`,
  sparkle: `<path ${W} d="M12 2.8c.6 4.6 2.4 6.6 7 7.2-4.6.6-6.4 2.6-7 7.2-.6-4.6-2.4-6.6-7-7.2 4.6-.6 6.4-2.6 7-7.2Z"/><path d="M12 2.8c.6 4.6 2.4 6.6 7 7.2-4.6.6-6.4 2.6-7 7.2-.6-4.6-2.4-6.6-7-7.2 4.6-.6 6.4-2.6 7-7.2ZM18.6 16.4c.2 1.6.8 2.2 2.4 2.4-1.6.2-2.2.8-2.4 2.4-.2-1.6-.8-2.2-2.4-2.4 1.6-.2 2.2-.8 2.4-2.4Z"/>`,
  qr: `<rect ${W} x="3" y="3" width="18" height="18" rx="2"/><path d="M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4Z"/><path d="M14 14h2.4v2.4H14ZM18 18h2v2h-2ZM14 18.6h2M18.6 14H20"/>`,
  arrow: `<path d="M4.6 12h14.4M13.4 6.2 19.2 12l-5.8 5.8" stroke-width="2.2"/>`,
  back: `<path d="M19.4 12H5M10.6 6.2 4.8 12l5.8 5.8" stroke-width="2.2"/>`,
  trash: `<path ${W} d="M6 7h12l-1 13.2H7Z"/><path d="M4 7h16M9.4 7V4.4h5.2V7M6 7l1 13.2h10L18 7M10 10.6v6.2M14 10.6v6.2"/>`,
  download: `<path d="M12 3.6v11.6M7 10.4l5 5 5-5M4.4 20.4h15.2" stroke-width="2.1"/>`,
  alert: `<path ${W} d="M12 3.4 21.4 20H2.6Z"/><path d="M12 3.4 21.4 20H2.6ZM12 9.6v4.8"/><circle cx="12" cy="17.2" r="1.1" fill="currentColor"/>`,
  refresh: `<path d="M19.6 8.4A8 8 0 0 0 4.4 10M4.4 15.6a8 8 0 0 0 15.2 1.6"/><path d="M19.8 3.8v4.8H15M4.2 20.2v-4.8H9" stroke-width="2"/>`,
  copy: `<rect ${W} x="8.4" y="8.4" width="12.2" height="12.2" rx="2.2"/><rect x="8.4" y="8.4" width="12.2" height="12.2" rx="2.2"/><path d="M15.6 8.4V5.4c0-1.1-.9-2-2-2H5.4c-1.1 0-2 .9-2 2v8.2c0 1.1.9 2 2 2h3"/>`,
  external: `<path d="M13.6 4h6.4v6.4M20 4l-9 9M17.6 13.6v5c0 .8-.6 1.4-1.4 1.4H5.4c-.8 0-1.4-.6-1.4-1.4V7.8c0-.8.6-1.4 1.4-1.4h5"/>`,
  shield: `<path ${W} d="M12 2.8 19.6 6v5.6c0 4.6-3.2 8.2-7.6 9.6-4.4-1.4-7.6-5-7.6-9.6V6Z"/><path d="M12 2.8 19.6 6v5.6c0 4.6-3.2 8.2-7.6 9.6-4.4-1.4-7.6-5-7.6-9.6V6Z"/><path d="m8.6 12 2.4 2.4 4.6-4.8" stroke-width="2"/>`,
  play: `<path ${W} d="M7 4.6v14.8L19.4 12Z"/><path d="M7 4.6v14.8L19.4 12Z"/>`,
  file: `<path ${W} d="M6 3h8l4.6 4.6V21H6Z"/><path d="M6 3h8l4.6 4.6V21H6ZM14 3v4.6h4.6"/>`,
  power: `<path d="M12 3.4v8M7.2 6.4a7.6 7.6 0 1 0 9.6 0" stroke-width="2.1"/>`,
  layers: `<path ${W} d="m12 3.6 9 4.8-9 4.8-9-4.8Z"/><path d="m12 3.6 9 4.8-9 4.8-9-4.8Zm-9 8.6 9 4.8 9-4.8M3 16.2 12 21l9-4.8"/>`,
  chat: `<path ${W} d="M4 5.4h16v10.8H10.4L6 20v-3.8H4Z"/><path d="M4 5.4h16v10.8H10.4L6 20v-3.8H4ZM8 9.6h8M8 12.4h5"/>`,
  tag: `<path ${W} d="M3.6 3.6h7.8l9 9-7.8 7.8-9-9Z"/><path d="M3.6 3.6h7.8l9 9-7.8 7.8-9-9Z"/><circle cx="8" cy="8" r="1.4"/>`,
  calendar: `<rect ${W} x="3.4" y="5" width="17.2" height="15.6" rx="2.2"/><rect x="3.4" y="5" width="17.2" height="15.6" rx="2.2"/><path d="M3.4 10h17.2M8 3v4M16 3v4M7.6 14h2M11 14h2M14.4 14h2M7.6 17h2"/>`,
  theme: `<path ${W} d="M12 3a9 9 0 0 0 0 18Z"/><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>`,
  spark: `<path d="M12 3v3.6M12 17.4V21M3 12h3.6M17.4 12H21M5.6 5.6l2.6 2.6M15.8 15.8l2.6 2.6M18.4 5.6l-2.6 2.6M8.2 15.8l-2.6 2.6" stroke-width="2"/>`,
};

export function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.innerHTML = PATHS[name] || PATHS.sparkle;
  return svg;
}
