const P: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  sliders: 'M4 7h9V5h2v2h5v2h-5v2h-2V9H4V7zm0 8h5v-2h2v2h9v2h-9v2H9v-2H4v-2z',
  cube: 'M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.5 3.6L12 11.5 5.5 7.9 12 4.3zM5 9.6l6 3.3v6.5l-6-3.3V9.6zm8 9.8v-6.5l6-3.3v6.5l-6 3.3z',
  download: 'M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4L11 12.2V3zM5 19h14v2H5v-2z',
};
export function Icon({ name, size = 22 }: { name: keyof typeof P; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={P[name]} /></svg>;
}
